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
    // Audit H18: previously silently acked, leaving real failed payments
    // stuck in pending forever. Now: rewind the webhook_events dedupe row
    // (so PChomePay's retry can re-attempt) and return 500. PChomePay's
    // retry policy will keep delivering until 2xx, giving queryPayment
    // multiple chances. If PChomePay eventually gives up, the order shows
    // pending and admin reconciles via /admin/orders.
    await supabase
      .from("webhook_events")
      .delete()
      .eq("gateway", "pchomepay")
      .eq("merchant_trade_no", merchantTradeNo)
    res.status(500).send("queryPayment failed; please retry")
    return
  }

  // Audit H18 (round 2): only trust the authoritative response. If
  // queryPayment succeeded above but returned no status_code, falling back to
  // the (forgeable) notify_message lets an attacker mark unpaid orders paid
  // by sending a crafted notify. Drop the notifyMessage fallback.
  //
  // PChomePay 成功時實測 authoritative.status="S" & status_code=null。
  // 舊 code 只認 status_code 導致 4 筆訂單卡在 pending(見 2026-07-12 事件),
  // 現同時檢查 status(主要成功旗標)與 status_code(失敗細節碼),兩者任一為 paid 就算 paid。
  const status = authoritative.status
  const statusCode = authoritative.status_code
  const isPaidSignal = (s?: string) => s === "S" || s === "00" || s === "1"
  const notifyTypeIsPaid = notifyType === "order_paid" || notifyType === "order_confirm"
  const isPaid = notifyTypeIsPaid && (isPaidSignal(status) || isPaidSignal(statusCode))
  const isFailed = notifyType === "order_expired" || status === "F" || statusCode === "F"

  // Find the payments row by gateway_tx_id (= order_number on PChomePay).
  const { data: tx } = await supabase
    .from("payments")
    .select("id, order_id, amount")
    .eq("gateway_tx_id", orderNumber)
    .maybeSingle()

  if (tx) {
    // Amount authority: never mark an order paid for less (or more) than it
    // owes. PChomePay returns the collected amount (integer TWD); compare it
    // to what we charged (payments.amount, TWD). A mismatch = under/over-pay
    // or a forged/altered notify → refuse to flip to paid, log loudly for
    // manual reconciliation, and ack so PChomePay stops retrying. If the
    // gateway didn't return an amount we can't compare, so we don't block.
    if (isPaid && authoritative.amount != null) {
      const collected = Math.round(Number(authoritative.amount))
      const expected = Math.round(Number(tx.amount ?? 0))
      if (collected !== expected) {
        console.error(
          `[webhooks/pchomepay] AMOUNT MISMATCH order=${orderNumber} ` +
            `collected=${collected} expected=${expected} — NOT marking paid, needs reconcile`,
        )
        res.send("success")
        return
      }
    }

    if (isPaid) {
      await supabase
        .from("payments")
        .update({
          status: "captured",
          raw_response: JSON.stringify({ notifyType, notifyMessage, authoritative }),
        })
        .eq("id", tx.id)

      const { error: paidErr } = await supabase
        .from("orders")
        .update({
          status: "processing",
          payment_status: "paid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.order_id)
      if (paidErr) {
        // Don't ack: rewind the dedupe row and 500 so PChomePay retries, else
        // the payment captures but the order is silently stuck on pending.
        console.error("[webhooks/pchomepay] order paid-flip failed:", paidErr)
        await supabase.from("webhook_events").delete()
          .eq("gateway", "pchomepay").eq("merchant_trade_no", merchantTradeNo)
        res.status(500).send("order update failed; please retry"); return
      }

      try {
        const { enqueuePostPaymentJobs } = await import("../../lib/enqueue-post-payment")
        await enqueuePostPaymentJobs(tx.order_id)
      } catch (err) {
        console.warn("[webhooks/pchomepay] enqueue jobs failed (non-fatal):", err)
      }
    } else if (isFailed) {
      // Guard: NEVER let a failed/expired notify clobber an order that is already
      // paid. This fires when a customer's abandoned "重新付款" second attempt
      // expires AFTER the first attempt already succeeded — the order_expired
      // notify would otherwise flip a real paid order to failed (2026-07 incident,
      // order #10000035). Both guards are atomic (no read-then-write race):
      //   - payments: don't downgrade a captured row (repay re-points its
      //     gateway_tx_id, so the expired notify can match the captured row).
      //   - orders: .neq("payment_status","paid") leaves a paid order untouched.
      await supabase
        .from("payments")
        .update({
          status: "failed",
          raw_response: JSON.stringify({ notifyType, notifyMessage, authoritative }),
        })
        .eq("id", tx.id)
        .neq("status", "captured")
      const { data: flipped } = await supabase
        .from("orders")
        .update({
          status: "failed",
          payment_status: "failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", tx.order_id)
        .neq("payment_status", "paid")
        .select("id")
      if (!flipped || flipped.length === 0) {
        console.warn(
          `[webhooks/pchomepay] ${notifyType} ignored for order ${tx.order_id} ` +
            `(already paid or gone) — tx ${orderNumber}`,
        )
      }
    }
    // refund_* and order_audit just get logged via webhook_events; no order
    // status flip until you wire a real refund / audit workflow.
  }

  res.send("success")
})
