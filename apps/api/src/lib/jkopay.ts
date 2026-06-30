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
  const apiUrl = getApiBaseUrl()
  const siteUrl = getSiteUrl()
  const { storeId, apiKey, secretKey, baseUrl } = await getCreds()

  // platform_order_id pattern mirrors the legacy WP woo-jkopay plugin:
  //   sprintf('%d-%s', $order_id, current_time('YmdHis'))
  // — keep the same scheme so JKO Pay support can cross-reference old +
  // new orders by the same id format.
  const ymdhms = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14)
  const platformOrderId = `${orderId}-${ymdhms}`

  // valid_time: "YYYY-MM-DD HH:mm:ss" in UTC+8, +30 minutes from now (matches
  // the PHP plugin's gmdate('Y-m-d H:i:s', current_time('timestamp') + 30 * MINUTE + 8 * HOUR)).
  const validAt = new Date(Date.now() + 30 * 60 * 1000 + 8 * 60 * 60 * 1000)
  const validTime = validAt.toISOString().replace("T", " ").slice(0, 19)

  // Payload shape lifted verbatim from class-wc-gateway-jkopay.php so the
  // request matches the format JKO Pay's API has been accepting from this
  // merchant for over a year. Notably: prices are integers (TWD dollars,
  // not cents); valid_time is a STRING; unredeem/payment_type/escrow are
  // mandatory; confirm_url / store_name / goods are NOT sent.
  const bodyObj = {
    platform_order_id: platformOrderId,
    store_id: storeId,
    currency: "TWD",
    total_price: Math.round(amount),
    final_price: Math.round(amount),
    unredeem: 0,
    result_url: `${apiUrl}/webhooks/jkopay`,
    result_display_url: `${siteUrl}/checkout/confirm?order=${encodeURIComponent(orderId)}`,
    valid_time: validTime,
    payment_type: "onetime",
    escrow: false,
  }
  const payload = JSON.stringify(bodyObj)

  // Digest = HMAC-SHA256(payload, secret) hex. Header names are
  // lowercase `api-key` / `digest`. Endpoint is /platform/entry (NOT
  // /order/create — that legacy path returned a generic 404). All four of
  // these (path / headers / payload shape / digest) come from the PHP
  // plugin's class-wc-jkopay-api.php + class-wc-gateway-jkopay.php; this
  // is a like-for-like Node port.
  const digest = createHmac("sha256", secretKey).update(payload).digest("hex")

  const response = await fetch(`${baseUrl}/platform/entry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      digest,
    },
    body: payload,
  })

  const text = await response.text()
  let data: Record<string, any> = {}
  try { data = JSON.parse(text) } catch { /* keep raw text for the log */ }

  // result "000" = success per JKO Pay convention; anything else is an
  // error with a human-readable `message`.
  if (data.result !== "000") {
    console.error(
      `[jkopay] /platform/entry failed status=${response.status} body=${text}`,
    )
    throw new Error(
      `JKOPay error: ${data.message ?? text ?? `HTTP ${response.status}`}`,
    )
  }
  const paymentUrl = data.result_object?.payment_url as string | undefined
  if (!paymentUrl) {
    console.error(`[jkopay] missing payment_url in response: ${text}`)
    throw new Error("JKOPay error: missing payment_url")
  }
  return { paymentUrl, merchantTradeNo: platformOrderId }
}
