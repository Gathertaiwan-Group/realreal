import { createHmac, randomUUID } from "crypto"
import { getApiBaseUrl } from "./urls"
import { getSettingOrEnv } from "./settings"

// LINE Pay v3 API — https://pay.line.me/developers/apis/onlineApis
// NOTE: LINE Pay does NOT support recurring / token payments. For subscriptions, use PChomePay only.

async function getCreds() {
  const [channelId, channelSecret, sandbox] = await Promise.all([
    getSettingOrEnv("linepay.channel_id", "LINEPAY_CHANNEL_ID"),
    getSettingOrEnv("linepay.channel_secret", "LINEPAY_CHANNEL_SECRET"),
    getSettingOrEnv("linepay.sandbox", "LINEPAY_SANDBOX"),
  ])
  return {
    channelId,
    channelSecret,
    baseUrl:
      sandbox === "true"
        ? "https://sandbox-api-pay.line.me"
        : "https://api-pay.line.me",
  }
}

export function signRequest(uri: string, body: string, channelSecret: string, nonce: string): string {
  const message = channelSecret + uri + body + nonce
  return createHmac("sha256", channelSecret).update(message).digest("base64")
}

export async function requestPayment(
  orderId: string,
  amount: number,
  productName: string
): Promise<{ paymentUrl: string; transactionId: string }> {
  const uri = "/v3/payments/request"
  const nonce = randomUUID()
  const apiUrl = getApiBaseUrl()
  const { channelId, channelSecret, baseUrl } = await getCreds()
  const bodyObj = {
    amount,
    currency: "TWD",
    orderId,
    packages: [
      {
        id: orderId,
        amount,
        name: productName,
        products: [{ name: productName, quantity: 1, price: amount }],
      },
    ],
    redirectUrls: {
      confirmUrl: `${apiUrl}/webhooks/linepay/confirm`,
      cancelUrl: `${apiUrl}/webhooks/linepay/cancel`,
    },
  }
  const body = JSON.stringify(bodyObj)
  const signature = signRequest(uri, body, channelSecret, nonce)

  const response = await fetch(`${baseUrl}${uri}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": channelId,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": signature,
    },
    body,
  })
  // Read raw text first — LINE Pay's transactionId is a 19-digit integer that
  // exceeds JS Number.MAX_SAFE_INTEGER. JSON.parse() would silently round it,
  // causing the stored gateway_tx_id to mismatch the value LINE Pay sends back
  // in the redirect URL (e.g. 2026053158491409700 → 2026053158491409664).
  const responseText = await response.text()
  const txIdMatch = responseText.match(/"transactionId"\s*:\s*(\d+)/)
  const rawTxId = txIdMatch?.[1] ?? null

  const data = JSON.parse(responseText) as Record<string, any>
  if (data.returnCode !== "0000") {
    throw new Error(`LINE Pay error: ${data.returnCode} ${data.returnMessage}`)
  }
  if (!rawTxId) {
    throw new Error("LINE Pay error: transactionId missing from response")
  }
  return {
    paymentUrl: data.info.paymentUrl.web as string,
    transactionId: rawTxId,
  }
}

export async function confirmPayment(transactionId: string, amount: number): Promise<void> {
  const uri = `/v3/payments/${transactionId}/confirm`
  const nonce = randomUUID()
  const body = JSON.stringify({ amount, currency: "TWD" })
  const { channelId, channelSecret, baseUrl } = await getCreds()
  const signature = signRequest(uri, body, channelSecret, nonce)

  const response = await fetch(`${baseUrl}${uri}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": channelId,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": signature,
    },
    body,
  })
  const data = await response.json() as Record<string, any>
  if (data.returnCode !== "0000") {
    throw new Error(`LINE Pay confirm error: ${data.returnCode} ${data.returnMessage}`)
  }
}
