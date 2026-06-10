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
    await confirmPayment(transactionId, payment.amount)

    await supabase
      .from("payments")
      .update({ status: "captured", updated_at: new Date().toISOString() })
      .eq("id", payment.id)

    await supabase
      .from("orders")
      .update({
        status: "processing",
        payment_status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.order_id)

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

    await supabase
      .from("orders")
      .update({
        status: "failed",
        payment_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", payment.order_id)

    res.redirect(`${siteUrl}/checkout/confirm?order=${orderId}&status=failed`)
  }
})

// GET /webhooks/linepay/cancel?orderId= — user cancelled payment
linepayWebhookRouter.get("/cancel", async (req, res) => {
  const { orderId } = req.query as { orderId: string }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"

  if (orderId) {
    await supabase
      .from("orders")
      .update({
        status: "cancelled",
        payment_status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("order_number", orderId)
  }

  res.redirect(`${siteUrl}/checkout/payment?error=cancelled`)
})
