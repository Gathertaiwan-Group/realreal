import { Router } from "express"
import { createHmac, timingSafeEqual } from "crypto"
import { supabase } from "../../lib/supabase"

export const pchomepayWebhookRouter = Router()

const SECRET = process.env.PCHOMEPAY_SECRET ?? ""

/**
 * POST /webhooks/pchomepay — PChomePay 支付連 server notification.
 *
 * PChomePay sends a JSON-ish form-encoded payload with a `sign` field that is
 * HMAC-SHA256(secret, JSON.stringify(payload_without_sign)).  We accept either
 * the form-encoded or JSON variants (Express has body parsers for both
 * registered above this router).
 *
 * Must return "1|OK" on success or PChomePay will keep retrying.
 */
pchomepayWebhookRouter.post("/", async (req, res) => {
  const params = { ...(req.body as Record<string, string>) }
  const sign = (params.sign as string) || ""
  delete params.sign

  // HMAC verification — same algorithm as the outbound createPayment() in
  // lib/pchomepay.ts so the gateway-merchant pair is symmetric.
  let valid = false
  if (SECRET && sign) {
    const expected = createHmac("sha256", SECRET)
      .update(JSON.stringify(params))
      .digest("hex")
    try {
      const a = Buffer.from(expected)
      const b = Buffer.from(sign)
      valid = a.length === b.length && timingSafeEqual(a, b)
    } catch { /* fallthrough — valid stays false */ }
  }
  if (!valid) {
    res.status(400).send("0|SignatureError"); return
  }

  const merchantTradeNo = (params.merchant_trade_no || params.MerchantTradeNo) as string
  const gatewayTradeNo = (params.trade_no || params.TradeNo) as string | undefined
  const rtnCode = (params.status || params.RtnCode || "") as string

  if (!merchantTradeNo) {
    res.status(400).send("0|MissingTradeNo"); return
  }

  // Idempotency guard — insert into webhook_events, catch unique constraint "23505"
  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      gateway: "pchomepay",
      merchant_trade_no: merchantTradeNo,
      payload: JSON.stringify(req.body),
    })

  if (idempotencyError) {
    if (idempotencyError.code === "23505") { res.send("1|OK"); return }
    console.error("[webhooks/pchomepay] idempotency insert failed:", idempotencyError)
    res.status(500).send("0|InternalError"); return
  }

  const success = rtnCode === "1" || rtnCode === "SUCCESS" || rtnCode === "success"

  // Find the payment row by gateway_tx_id (= merchant_trade_no on PChomePay).
  const { data: tx } = await supabase
    .from("payments")
    .select("id, order_id")
    .eq("gateway_tx_id", merchantTradeNo)
    .maybeSingle()

  if (tx) {
    await supabase
      .from("payments")
      .update({
        status: success ? "captured" : "failed",
        raw_response: JSON.stringify({ ...req.body, gateway_trade_no: gatewayTradeNo }),
      })
      .eq("id", tx.id)

    await supabase
      .from("orders")
      .update({
        status: success ? "processing" : "failed",
        payment_status: success ? "paid" : "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tx.order_id)

    if (success) {
      try {
        const { enqueuePostPaymentJobs } = await import("../../lib/enqueue-post-payment")
        await enqueuePostPaymentJobs(tx.order_id)
      } catch (err) {
        console.warn("[webhooks/pchomepay] enqueue jobs failed (non-fatal):", err)
      }
    }
  }

  res.send("1|OK")
})
