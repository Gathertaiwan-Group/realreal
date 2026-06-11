import axios from "axios"
import { getSettingOrEnv } from "./settings"

/**
 * PChomePay 支付連 API client.
 *
 * Auth is a two-step OAuth-style flow (NOT direct Bearer):
 *   1. POST /v1/token with Authorization: Basic base64(APP_ID:SECRET)
 *      → { token, expired_timestamp }  (token lifetime ≈ 30 min)
 *   2. POST /v1/payment with custom header  pcpay-token: <token>
 *      (NOT Authorization: Bearer)
 *
 * Cached so we don't burn a token call on every order.
 *
 * Reference: PChomePay's own WooCommerce plugin
 *   https://github.com/PChomePay/PChomePay-Cart-for-WooCommerce
 */

async function getCreds() {
  const [appId, secret, sandbox, payTypesRaw] = await Promise.all([
    getSettingOrEnv("pchomepay.app_id", "PCHOMEPAY_APP_ID"),
    getSettingOrEnv("pchomepay.secret", "PCHOMEPAY_SECRET"),
    getSettingOrEnv("pchomepay.sandbox", "PCHOMEPAY_SANDBOX"),
    getSettingOrEnv("pchomepay.pay_types", "PCHOMEPAY_PAY_TYPES", "CARD"),
  ])
  const isSandbox = sandbox === "true"
  return {
    appId,
    secret,
    isSandbox,
    baseUrl: isSandbox
      ? "https://sandbox-api.pchomepay.com.tw"
      : "https://api.pchomepay.com.tw",
    payTypes: payTypesRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

interface CachedToken {
  value: string
  /** Unix ms at which the token expires (server-provided). */
  expiresAt: number
}
let tokenCache: CachedToken | null = null

async function getToken(): Promise<string> {
  // Use cached if it's still good for at least another minute.
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.value
  }

  const { appId, secret, baseUrl } = await getCreds()
  if (!appId || !secret) {
    throw new Error("Missing PChomePay APP_ID / SECRET (check /admin/settings or env)")
  }

  const basic = Buffer.from(`${appId}:${secret}`).toString("base64")
  try {
    const res = await axios.post(
      `${baseUrl}/v1/token`,
      {},
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${basic}`,
        },
        timeout: 15000,
      },
    )
    const data = res.data as { token?: string; expired_timestamp?: number }
    if (!data.token) {
      throw new Error(`PChomePay token endpoint returned no token: ${JSON.stringify(data)}`)
    }
    // expired_timestamp is in unix seconds. Fall back to +25 min if missing.
    const expiresAt =
      typeof data.expired_timestamp === "number"
        ? data.expired_timestamp * 1000
        : Date.now() + 25 * 60 * 1000
    tokenCache = { value: data.token, expiresAt }
    return data.token
  } catch (err) {
    tokenCache = null
    if (axios.isAxiosError(err)) {
      throw new Error(
        `PChomePay token exchange failed (HTTP ${err.response?.status}): ${JSON.stringify(err.response?.data ?? err.message)}`,
      )
    }
    throw err
  }
}

export interface CreatePaymentParams {
  orderId: string
  orderNumber: string
  amount: number
  itemName: string
  returnUrl: string
  notifyUrl: string
  /** Required by PChomePay so they can email the buyer the e-invoice / receipt. */
  buyerEmail?: string
}

export async function createPayment(
  params: CreatePaymentParams,
): Promise<{ paymentUrl: string; orderId: string }> {
  const [token, { baseUrl, payTypes }] = await Promise.all([getToken(), getCreds()])
  const body = {
    order_id: params.orderNumber,
    pay_type: payTypes.length > 0 ? payTypes : ["CARD"],
    amount: Math.round(params.amount),
    return_url: params.returnUrl,
    notify_url: params.notifyUrl,
    items: [{ name: params.itemName, url: params.returnUrl }],
    buyer_email: params.buyerEmail ?? "noreply@realreal.cc",
    atm_info: { expire_days: 3 },
  }

  try {
    const res = await axios.post(`${baseUrl}/v1/payment`, body, {
      headers: {
        "Content-Type": "application/json",
        "pcpay-token": token,
      },
      timeout: 30000,
    })
    const data = res.data as { order_id?: string; payment_url?: string }
    if (!data.payment_url) {
      throw new Error(`PChomePay create-payment returned no payment_url: ${JSON.stringify(data)}`)
    }
    return { paymentUrl: data.payment_url, orderId: data.order_id ?? params.orderNumber }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      // Token might have expired between our cache check and the real call →
      // bust cache so the next attempt re-issues. Mostly belt-and-braces.
      if (err.response?.status === 401) tokenCache = null
      throw new Error(
        `PChomePay create-payment failed (HTTP ${err.response?.status}): ${JSON.stringify(err.response?.data ?? err.message)}`,
      )
    }
    throw err
  }
}

/** Server-to-server verification used by the webhook handler. */
export async function queryPayment(orderId: string) {
  const [token, { baseUrl }] = await Promise.all([getToken(), getCreds()])
  const res = await axios.get(
    `${baseUrl}/v1/payment/${encodeURIComponent(orderId)}`,
    {
      headers: { "pcpay-token": token },
      timeout: 15000,
    },
  )
  return res.data as {
    order_id: string
    status_code?: string
    pay_type?: string
    // Authoritative amount the gateway actually collected (integer TWD).
    // Used by the webhook to reject under/over-payments before marking paid.
    amount?: number
    payment_info?: Record<string, unknown>
  }
}
