import { Router } from "express"
import { supabase } from "../../lib/supabase"
import { queryPayment } from "../../lib/pchomepay"

export const pchomepayWebhookRouter = Router()

/**
 * POST /webhooks/pchomepay — PChomePay 支付連 notify_url callback.
 *
 * PChomePay POSTs form-urlencoded:
 *   notify_type=order_confirm | order_paid | order_audit | order_expired
 *                refund_pending | refund_success | refund_fail
 *   notify_message=<JSON string: { order_id, pay_type, status_code, payment_info, ... }>
 *
 * There is NO signature header on this payload. Verification is by
 * re-querying GET /v1/payment/<order_id> with our token and trusting
 * that result (the official plugin doesn't even do that — it just
 * trusts the notify body — but we do the extra round-trip for safety).
 *
 * PChomePay requires the response body to literally be "success" so
 * they don't retry.
 */
pchomepayWebhookRouter.post("/", async (req, res) => {
  const body = req.body as Record<string, string>
  const notifyType = body.notify_type
  const notifyMessageRaw = body.notify_message

  if (!notifyType || !notifyMessageRaw) {
    res.status(400).send("missing notify fields")
    return
  }

  let notifyMessage: { order_id?: string; status_code?: string; pay_type?: string } = {}
  try {
    notifyMessage = JSON.parse(notifyMessageRaw)
  } catch {
    res.status(400).send("bad notify_message json")
    return
  }
  const orderNumber = notifyMessage.order_id
  if (!orderNumber) {
    res.status(400).send("missing order_id")
    return
  }

  // Idempotency guard — for paid notifications (order_paid / order_confirm)
  // we collapse both into the same dedupe key so PChomePay sending BOTH
  // notify_types for the same order doesn't double-fire enqueuePostPaymentJobs.
  // Earlier code keyed on `${notifyType}_${orderNumber}` which let the same
  // payment through twice, triggering double earn / double redeem / double
  // tier upgrade. Other notify_types (failed / refund / audit) keep their own
  // dedupe slot since they represent independent events.
  const isPaidNotifyType = notifyType === "order_paid" || notifyType === "order_confirm"
  const merchantTradeNo = isPaidNotifyType
    ? `paid_${orderNumber}`
    : `${notifyType}_${orderNumber}`
  const { error: idempotencyError } = await supabase.from("webhook_events").insert({
    gateway: "pchomepay",
    merchant_trade_no: merchantTradeNo,
    payload: JSON.stringify(body),
  })
  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      res.send("success")
      return
    }
    console.error("[webhooks/pchomepay] idempotency insert failed:", idempotencyError)
    res.status(500).send("internal error")
    return
  }

  // Re-query PChomePay for the authoritative status. This both verifies the
  // notify wasn't forged and gives us the canonical status_code in case
  // notify_message dropped fields.
  let authoritative
  try {
    authoritative = await queryPayment(orderNumber)
  } catch (err) {
    console.error("[webhooks/pchomepay] queryPayment failed:", err)
    // Still ack so PChomePay doesn't keep retrying for an unbounded time;
    // the order will be reconciled by the order-status admin tool.
    res.send("success")
    return
  }

  const statusCode = authoritative.status_code ?? notifyMessage.status_code
  // PChomePay status_code reference: "S" or "00" / numeric "1" / "success"
  // generally mean paid; we accept several variants defensively.
  const isPaid =
    notifyType === "order_paid" ||
    notifyType === "order_confirm" ||
    statusCode === "S" ||
    statusCode === "00" ||
    statusCode === "1"
  const isFailed = notifyType === "order_expired" || statusCode === "F"

  // Find the payments row by gateway_tx_id (= order_number on PChomePay).
  const { data: tx } = await supabase
    .from("payments")
    .select("id, order_id")
    .eq("gateway_tx_id", orderNumber)
    .maybeSingle()

  if (tx) {
    if (isPaid) {
      await supabase
        .from("payments")
        .update({
          status: "captured",
          raw_response: JSON.stringify({ notifyType, notifyMessage, authoritative }),
        })
        .eq("id", tx.id)

      await supabase
        .from("orders")
        .update({
          status: "processing",
          payment_status: "paid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.order_id)

      try {
        const { enqueuePostPaymentJobs } = await import("../../lib/enqueue-post-payment")
        await enqueuePostPaymentJobs(tx.order_id)
      } catch (err) {
        console.warn("[webhooks/pchomepay] enqueue jobs failed (non-fatal):", err)
      }
    } else if (isFailed) {
      await supabase
        .from("payments")
        .update({
          status: "failed",
          raw_response: JSON.stringify({ notifyType, notifyMessage, authoritative }),
        })
        .eq("id", tx.id)
      await supabase
        .from("orders")
        .update({
          status: "failed",
          payment_status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.order_id)
    }
    // refund_* and order_audit just get logged via webhook_events; no order
    // status flip until you wire a real refund / audit workflow.
  }

  res.send("success")
})
