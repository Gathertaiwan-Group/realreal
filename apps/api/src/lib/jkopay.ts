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
      sandbox === "true" ? "https://uat-onlinepay.jkopay.app" : "https://onlinepay.jkopay.com",
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
  // platform_order_id format mirrors the legacy WP woo-jkopay plugin's
  // pattern (<orderId>-<YYYYMMDDhhmmss>) so JKO Pay support can cross
  // reference old + new orders by the same scheme.
  const ts = new Date()
    .toISOString()
    .replace(/\D/g, "")
    .slice(0, 14)
  const platformOrderId = `${orderId}-${ts}`
  const apiUrl = getApiBaseUrl()
  const siteUrl = getSiteUrl()
  const { storeId, apiKey, secretKey, baseUrl } = await getCreds()

  // Field shape inferred from JKO Pay callbacks captured in the legacy WP
  // backup (wp_comments rows mention platform_order_id, final_price,
  // result_url, redeem_amount/redeem_detail, etc.). Currency in TWD,
  // prices in dollars (not cents).
  const bodyObj = {
    store_id: storeId,
    platform_order_id: platformOrderId,
    currency: "TWD",
    total_price: amount,
    final_price: amount,
    valid_time: 900,
    confirm_url: `${apiUrl}/webhooks/jkopay`,
    result_url: `${apiUrl}/webhooks/jkopay`,
    result_display_url: `${siteUrl}/checkout/confirm?order=${encodeURIComponent(orderId)}`,
    store_name: "誠真生活 RealReal",
    goods: `realreal order ${orderId}`,
  }
  const payload = JSON.stringify(bodyObj)
  // Digest format: HMAC-SHA256(secret, payload) → hex. TODO: verify against
  // JKO Pay's official integration doc; current code's previous format was
  // also hex-hmac (only the header names + endpoint path were wrong) so this
  // matches what we know. If the gateway still returns
  // {"result":"201","message":"Authentication failed"}, the digest needs a
  // different recipe (base64 hmac? sha256(secret+body)? a nonce?) — try
  // alternatives once the JKO Pay developer doc or the legacy
  // wp-content/plugins/woo-jkopay/ PHP source is available.
  const digest = createHmac("sha256", secretKey).update(payload).digest("hex")

  // Endpoint path confirmed by probing onlinepay.jkopay.com — the previous
  // `/order/create` returned a generic 404. /platform/entry/transaction/
  // online_pay/order/create echoes a structured JSON response so we know
  // it's the right route. Headers are Api-Key + Digest (NOT
  // X-Api-Key / X-Signature, which produced "header Api-Key and Digest
  // are required" errors).
  const url = `${baseUrl}/platform/entry/transaction/online_pay/order/create`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey,
      Digest: digest,
    },
    body: payload,
  })

  const text = await response.text()
  let data: Record<string, any> = {}
  try { data = JSON.parse(text) } catch { /* keep text */ }

  // JKO Pay convention: result "000" / "0" = success, others are errors with
  // a message. The successful response object holds a `payment_url` to
  // redirect the buyer.
  const paymentUrl = data?.result_object?.payment_url ?? data?.payment_url
  if (!paymentUrl) {
    console.error(
      `[jkopay] order/create failed status=${response.status} body=${text}`,
    )
    throw new Error(`JKOPay error: ${text || `HTTP ${response.status}`}`)
  }
  return { paymentUrl: paymentUrl as string, merchantTradeNo: platformOrderId }
}
