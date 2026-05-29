import { createHmac, randomUUID } from "crypto"
import { getApiBaseUrl } from "./urls"

// LINE Pay v3 API — https://pay.line.me/developers/apis/onlineApis
// NOTE: LINE Pay does NOT support recurring / token payments. For subscriptions, use PChomePay only.

const CHANNEL_ID = process.env.LINEPAY_CHANNEL_ID ?? ""
const CHANNEL_SECRET = process.env.LINEPAY_CHANNEL_SECRET ?? ""

const BASE_URL = process.env.LINEPAY_SANDBOX === "true"
  ? "https://sandbox-api-pay.line.me"
  : "https://api-pay.line.me"

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
  const signature = signRequest(uri, body, CHANNEL_SECRET, nonce)

  const response = await fetch(`${BASE_URL}${uri}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": CHANNEL_ID,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": signature,
    },
    body,
  })
  const data = await response.json() as Record<string, any>
  if (data.returnCode !== "0000") {
    throw new Error(`LINE Pay error: ${data.returnCode} ${data.returnMessage}`)
  }
  return {
    paymentUrl: data.info.paymentUrl.web as string,
    transactionId: String(data.info.transactionId),
  }
}

export async function confirmPayment(transactionId: string, amount: number): Promise<void> {
  const uri = `/v3/payments/${transactionId}/confirm`
  const nonce = randomUUID()
  const body = JSON.stringify({ amount, currency: "TWD" })
  const signature = signRequest(uri, body, CHANNEL_SECRET, nonce)

  const response = await fetch(`${BASE_URL}${uri}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": CHANNEL_ID,
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
