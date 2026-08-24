import { Router } from "express"
import { supabase } from "../../lib/supabase"
import { confirmPayment } from "../../lib/linepay"

export const linepayWebhookRouter = Router()

// GET /webhooks/linepay/confirm?transactionId=&orderId= — LINE Pay redirects browser here after payment
linepayWebhookRouter.get("/confirm", async (req, res) => {
  const { transactionId, orderId } = req.query as { transactionId: string; orderId: string }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"

  if (!transactionId || !orderId) {
    res.redirect(`${siteUrl}/checkout/confirm?status=error`); return
  }

  // Idempotency guard
  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      gateway: "linepay",
      merchant_trade_no: `confirm_${transactionId}`,
      payload: JSON.stringify(req.query),
    })

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      // Already confirmed — redirect as success
      res.redirect(`${siteUrl}/checkout/confirm?order=${orderId}&status=success`); return
    }
    console.error("[webhooks/linepay] idempotency insert failed:", idempotencyError)
    res.redirect(`${siteUrl}/checkout/confirm?order=${orderId}&status=error`); return
  }

  // Look up the payment by gateway_tx_id (the LINE Pay transactionId)
  const { data: payment } = await supabase
    .from("payments")
    .select("id, order_id, amount")
    .eq("gateway_tx_id", transactionId)
    .single()

  if (!payment) {
    console.error("[webhooks/linepay] payment not found for transactionId:", transactionId)
    res.redirect(`${siteUrl}/checkout/confirm?order=${orderId}&status=error`); return
  }

  try {
    // confirmPayment hits LINE Pay's confirm API with the DB amount; LINE Pay
    // rejects if the amount/reservation don't match, so the capture is
    // amount-verified gateway-side.
    await confirmPayment(transactionId, payment.amount)

    const { error: captureErr } = await supabase
      .from("payments")
      .update({ status: "captured", updated_at: new Date().toISOString() })
      .eq("id", payment.id)
    if (captureErr) {
      // Payment captured at LINE Pay but the local payments-row flip failed —
      // log loudly so it can be reconciled. Seen in the wild as payments.status
      // stuck on "pending" forever even though the order below correctly ends
      // up payment_status="paid" (orders#10000114, #10000123) — this was
      // previously silent (no error was even checked here).
      console.error("[webhooks/linepay] payments row capture-flip failed:", captureErr)
    }

    const { error: paidErr } = await supabase
      .from("orders")
      .update({
        status: "processing",
        payment_status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.order_id)
    if (paidErr) {
      // Payment captured at LINE Pay but the local flip failed — log loudly so
      // it can be reconciled; the customer still sees success (money taken).
      console.error("[webhooks/linepay] order paid-flip failed AFTER capture:", paidErr)
    }

    // Enqueue email + invoice jobs
    try {
      const { enqueuePostPaymentJobs } = await import("../../lib/enqueue-post-payment")
      await enqueuePostPaymentJobs(payment.order_id)
    } catch (err) {
      console.warn("[webhooks/linepay] enqueue jobs failed (non-fatal):", err)
    }

    res.redirect(`${siteUrl}/checkout/confirm?order=${orderId}&status=success`)
  } catch (err) {
    console.error("[webhooks/linepay] confirm failed:", err)

    await supabase
      .from("payments")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", payment.id)
      .neq("status", "captured")

    // Guard: never let a confirm-failure clobber an order that is already paid
    // (parity with pchomepay #10000035 — a captured order must survive a later
    // failed / forged confirm attempt).
    await supabase
      .from("orders")
      .update({
        status: "failed",
        payment_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.order_id)
      .neq("payment_status", "paid")

    res.redirect(`${siteUrl}/checkout/confirm?order=${orderId}&status=failed`)
  }
})

// GET /webhooks/linepay/cancel?orderId= — user cancelled payment.
// This is an unauthenticated browser redirect, so it must NOT be able to cancel
// arbitrary orders: only flip orders that are still pending+unpaid (the only
// valid state for a LINE Pay cancel), and restore the stock that order creation
// deducted. order_number is random (RR+timestamp+4 random bytes) → not guessable.
linepayWebhookRouter.get("/cancel", async (req, res) => {
  const { orderId } = req.query as { orderId: string }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"

  if (orderId) {
    const { data: order } = await supabase
      .from("orders")
      .select("id, status, payment_status")
      .eq("order_number", orderId)
      .maybeSingle()

    if (order) {
      // Atomic guard (was read-then-write): only cancel an order that is STILL
      // pending + unpaid at write time. If a concurrent /confirm flipped it to
      // paid/processing between our read and this write, these conditions match
      // 0 rows so we neither cancel nor restore stock — preventing a
      // paid-but-cancelled dirty state and a phantom stock restore (TOCTOU).
      const { data: cancelled, error: cancelErr } = await supabase
        .from("orders")
        .update({ status: "cancelled", payment_status: "failed", updated_at: new Date().toISOString() })
        .eq("id", order.id)
        .eq("status", "pending")
        .neq("payment_status", "paid")
        .select("id")
      if (cancelErr) {
        console.error("[webhooks/linepay] cancel update failed:", cancelErr)
      } else if (cancelled && cancelled.length > 0) {
        // Return the stock deducted at order creation (only when we actually cancelled).
        const { data: items } = await supabase
          .from("order_items")
          .select("variant_id, qty")
          .eq("order_id", order.id)
        const variants = (items ?? [])
          .filter((i) => i.variant_id && Number(i.qty) > 0)
          .map((i) => ({ id: i.variant_id, qty: Number(i.qty) }))
        if (variants.length > 0) {
          const { error: restoreErr } = await supabase.rpc("atomic_restore_stock", { p_variants: variants })
          if (restoreErr) console.warn("[webhooks/linepay] cancel stock restore failed:", restoreErr.message)
        }
      }
    }
  }

  res.redirect(`${siteUrl}/checkout/payment?error=cancelled`)
})
