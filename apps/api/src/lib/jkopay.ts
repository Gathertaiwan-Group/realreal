import { createHmac, timingSafeEqual } from "crypto"
import { getApiBaseUrl, getSiteUrl } from "./urls"
import { getSettingOrEnv } from "./settings"

// JKOPay Online Payment API — https://developer.jkopay.com/
// NOTE: JKOPay does NOT support recurring / token payments. For subscriptions, use PChomePay only.

async function getCreds() {
  const [storeId, apiKey, secretKey, sandbox] = await Promise.all([
    getSettingOrEnv("jkopay.store_id", "JKOPAY_STORE_ID"),
    getSettingOrEnv("jkopay.api_key", "JKOPAY_API_KEY"),
    getSettingOrEnv("jkopay.secret_key", "JKOPAY_SECRET_KEY"),
    getSettingOrEnv("jkopay.sandbox", "JKOPAY_SANDBOX"),
  ])
  return {
    storeId,
    apiKey,
    secretKey,
    baseUrl:
      sandbox === "true" ? "https://uat-api.jkopay.com" : "https://api.jkopay.com",
  }
}

export function verifySignature(payload: string, signature: string, secret: string): boolean {
  const computed = createHmac("sha256", secret).update(payload).digest("hex")
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}

/** Resolve the current JKOPay secret_key for webhook signature verification. */
export async function getJkopaySecretKey(): Promise<string> {
  return getSettingOrEnv("jkopay.secret_key", "JKOPAY_SECRET_KEY")
}

export async function initiatePayment(
  orderId: string,
  amount: number
): Promise<{ paymentUrl: string; merchantTradeNo: string }> {
  const merchantTradeNo = `RRJ${Date.now()}`
  const apiUrl = getApiBaseUrl()
  const siteUrl = getSiteUrl()
  const { storeId, apiKey, secretKey, baseUrl } = await getCreds()

  const bodyObj = {
    store_id: storeId,
    merchant_trade_no: merchantTradeNo,
    currency: "TWD",
    total_price: amount,
    order_desc: `realreal.cc 訂單 ${orderId.slice(0, 8)}`,
    result_url: `${siteUrl}/checkout/confirm`,
    notify_url: `${apiUrl}/webhooks/jkopay`,
  }
  const payload = JSON.stringify(bodyObj)
  const signature = createHmac("sha256", secretKey).update(payload).digest("hex")

  const response = await fetch(`${baseUrl}/order/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Store-ID": storeId,
      "X-Api-Key": apiKey,
      "X-Signature": signature,
    },
    body: payload,
  })
  const data = await response.json() as Record<string, any>
  if (!data.payment_url) {
    throw new Error(`JKOPay error: ${JSON.stringify(data)}`)
  }
  return { paymentUrl: data.payment_url as string, merchantTradeNo }
}
