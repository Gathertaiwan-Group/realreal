import { createHmac } from "crypto"
import { timingSafeEqual } from "crypto"

// ---------------------------------------------------------------------------
// Webhook verification (CheckMacValue)
// Used to verify inbound POST notifications from PChomePay.
// Sort params alphabetically, URL-encode, wrap with HashKey/HashIV, then HMAC-SHA256.
// ---------------------------------------------------------------------------

export function buildCheckMacValue(params: Record<string, string>, hashKey: string, hashIV: string): string {
  const sorted = Object.keys(params).sort().reduce((acc, k) => ({ ...acc, [k]: params[k] }), {} as Record<string, string>)
  const str = `HashKey=${hashKey}&${new URLSearchParams(sorted).toString()}&HashIV=${hashIV}`
  const encoded = encodeURIComponent(str).toLowerCase()
    .replace(/%20/g, "+").replace(/%21/g, "!").replace(/%28/g, "(").replace(/%29/g, ")")
    .replace(/%2a/g, "*").replace(/%2d/g, "-").replace(/%2e/g, ".").replace(/%5f/g, "_")
  return createHmac("sha256", hashKey).update(encoded).digest("hex").toUpperCase()
}

export function verifyCheckMacValue(params: Record<string, string>, hashKey: string, hashIV: string): boolean {
  const { CheckMacValue, ...rest } = params
  if (!CheckMacValue) return false
  const expected = buildCheckMacValue(rest, hashKey, hashIV)
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(CheckMacValue.toUpperCase()))
  } catch { return false }
}

// ---------------------------------------------------------------------------
// Payment creation
// POST to PChomePay API to create a payment request and obtain a payment URL.
// The `sign` field is HMAC-SHA256 of the JSON body using PCHOMEPAY_SECRET.
// ---------------------------------------------------------------------------

const PCHOMEPAY_API_URL = process.env.PCHOMEPAY_SANDBOX === "true"
  ? "https://sandbox-api.pchomepay.com.tw/v1/payment"
  : "https://api.pchomepay.com.tw/v1/payment"

export async function createPayment(params: {
  orderId: string
  orderNumber: string
  amount: number
  itemName: string
  returnUrl: string
  notifyUrl: string
}): Promise<{ paymentUrl: string }> {
  const appId = process.env.PCHOMEPAY_APP_ID
  const secret = process.env.PCHOMEPAY_SECRET
  if (!appId || !secret) {
    throw new Error("Missing PCHOMEPAY_APP_ID or PCHOMEPAY_SECRET env vars")
  }

  const body = {
    app_id: appId,
    order_id: params.orderNumber,
    amount: params.amount,
    return_url: params.returnUrl,
    notify_url: params.notifyUrl,
    items: [{ name: params.itemName, quantity: 1, price: params.amount }],
  }

  const payload = JSON.stringify(body)
  const sign = createHmac("sha256", secret).update(payload).digest("hex")

  const response = await fetch(PCHOMEPAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, sign }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PChomePay API error (HTTP ${response.status}): ${text}`)
  }

  const data = (await response.json()) as Record<string, unknown>
  const paymentUrl = data.payment_url as string | undefined

  if (!paymentUrl) {
    throw new Error(`PChomePay API did not return payment_url: ${JSON.stringify(data)}`)
  }

  return { paymentUrl }
}
