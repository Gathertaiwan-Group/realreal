import { Router } from "express"
import { supabase } from "../../lib/supabase"

export const jkopayWebhookRouter = Router()

async function restoreStockForOrder(orderId: string) {
  const { data: items, error } = await supabase
    .from("order_items")
    .select("variant_id, qty")
    .eq("order_id", orderId)

  if (error) throw new Error(error.message)

  const variants = (items ?? [])
    .filter((item: any) => item.variant_id && Number(item.qty) > 0)
    .map((item: any) => ({ id: item.variant_id, qty: Number(item.qty) }))

  if (variants.length === 0) return

  const restored = await supabase.rpc("atomic_restore_stock", { p_variants: variants })
  if (restored.error) throw new Error(restored.error.message)
}

// POST /webhooks/jkopay — JKOPay result_url callback.
//
// 1:1 port of woo-jkopay 0.1.0 PHP plugin (class-wc-gateway-jkopay.php
// handle_callback). Key facts from the canonical plugin:
//
//   - JKO Pay does NOT sign the result_url callback. The earlier
//     X-Signature/HMAC gate had no counterpart in JKO's actual protocol —
//     every legitimate callback was being rejected with HTTP 400, which is
//     why the production DB has zero jkopay webhook_events rows despite
//     real successful payments (orders 10000008 / 10000012 stuck at
//     payment_status=pending).
//   - Body shape: { transaction: { platform_order_id, status, tradeNo, ... } }
//     (sometimes flattened without the `transaction` wrapper — handle both).
//   - status === 0 OR status === "0" → SUCCESS. Anything else → FAIL.
//   - platform_order_id format: `${orderNumber}-${YYYYMMDDHHmmss}`. The PHP
//     plugin uses regex `^(\d+)-` to extract the WooCommerce order ID.
//     For us, the left-of-dash portion is the order_number we stamped in
//     initiatePayment(). We resolve order via payments.gateway_tx_id
//     (which holds the full `platform_order_id`) AND fall back to
//     orders.order_number for safety.
//   - Idempotent: webhook_events row keyed by (gateway, merchant_trade_no)
//     dedupes retries; we still re-check order.payment_status before
//     re-running side effects.
//   - Always returns 200 OK so JKO doesn't retry unnecessarily once the
//     callback is acknowledged.
jkopayWebhookRouter.post("/", async (req, res) => {
  const rawBody =
    (req as { rawBody?: string }).rawBody ??
    (typeof req.body === "string" ? req.body : JSON.stringify(req.body))

  console.log(`[webhooks/jkopay] received: ${rawBody.slice(0, 600)}`)

  let body: Record<string, unknown> = {}
  try {
    body = typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>)
      : JSON.parse(rawBody)
  } catch {
    console.warn("[webhooks/jkopay] body not JSON — acking with 200 to stop retries")
    res.status(200).send("OK")
    return
  }

  // PHP plugin: $tx = $data['transaction'] ?? $data;
  const tx = (
    body.transaction && typeof body.transaction === "object"
      ? (body.transaction as Record<string, unknown>)
      : body
  )

  const platformOrderId = (tx.platform_order_id ?? tx.platformOrderId) as
    | string
    | undefined
  if (!platformOrderId) {
    console.warn("[webhooks/jkopay] missing platform_order_id — acking")
    res.status(200).send("OK")
    return
  }

  // Idempotency guard. Use platform_order_id as the dedupe key (matches
  // JKO's per-trade uniqueness — same id can't be ack'd twice).
  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      gateway: "jkopay",
      merchant_trade_no: platformOrderId,
      payload: body as object,
    })

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      // Already processed — JKO retry of an ack'd event. Still return 200.
      res.status(200).send("OK")
      return
    }
    console.error("[webhooks/jkopay] webhook_events insert failed:", idempotencyError)
    // Don't 500 — JKO retries forever and we'd accumulate noise. Continue
    // best-effort and log.
  }

  // Status: 0 (number) OR "0" (string) === SUCCESS. Anything else fails.
  const statusCode = tx.status
  const success = statusCode === 0 || statusCode === "0"
  const tradeNo = (tx.tradeNo ?? tx.trade_no) as string | undefined

  // Resolve the order. payments.gateway_tx_id stores the full platform_order_id
  // (set in initiatePayment as the merchantTradeNo). Fallback: extract the
  // order_number (left of the `-`) and look up orders directly.
  let orderId: string | null = null
  let paymentId: string | null = null

  const { data: tx1 } = await supabase
    .from("payments")
    .select("id, order_id")
    .eq("gateway_tx_id", platformOrderId)
    .maybeSingle()

  if (tx1) {
    orderId = (tx1 as { order_id: string }).order_id
    paymentId = (tx1 as { id: string }).id
  } else {
    const orderNumber = platformOrderId.split("-")[0]
    const { data: orderRow } = await supabase
      .from("orders")
      .select("id")
      .eq("order_number", orderNumber)
      .maybeSingle()
    if (orderRow) {
      orderId = (orderRow as { id: string }).id
    }
  }

  if (!orderId) {
    console.warn(
      `[webhooks/jkopay] no order found for platform_order_id=${platformOrderId}`,
    )
    res.status(200).send("OK")
    return
  }

  // Update payments row (insert one if we couldn't find it earlier — covers
  // a race where the order existed but no payments row was written).
  const paymentPatch = {
    status: success ? "captured" : "failed",
    raw_response: JSON.stringify({ ...body, tradeNo }),
  }
  if (paymentId) {
    // On a fail callback, don't downgrade an already-captured payment (a late
    // or forged fail for a repay-captured order can match this same row).
    let pq = supabase.from("payments").update(paymentPatch).eq("id", paymentId)
    if (!success) pq = pq.neq("status", "captured")
    await pq
  } else {
    await supabase.from("payments").insert({
      order_id: orderId,
      gateway: "jkopay",
      gateway_tx_id: platformOrderId,
      amount: Number((tx.final_price ?? tx.total_price ?? 0) as number),
      status: paymentPatch.status,
      raw_response: paymentPatch.raw_response,
    })
  }

  // Restore stock on failure (only if order isn't already paid via another
  // signal). Done BEFORE flipping order status so a paid-then-failed-retry
  // doesn't double-restore.
  if (!success) {
    const { data: orderForStock } = await supabase
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .maybeSingle()
    if (
      (orderForStock as { payment_status?: string } | null)?.payment_status !==
      "paid"
    ) {
      try {
        await restoreStockForOrder(orderId)
      } catch (err) {
        console.warn("[webhooks/jkopay] restore stock failed (non-fatal):", err)
      }
    }
  }

  // Flip order status. Use payment_status as the idempotency check — if it's
  // already "paid" we skip the post-payment chain to avoid double-grant of
  // points / double-issue of invoice.
  const { data: orderBefore } = await supabase
    .from("orders")
    .select("payment_status")
    .eq("id", orderId)
    .maybeSingle()
  const alreadyPaid =
    (orderBefore as { payment_status?: string } | null)?.payment_status === "paid"

  if (success) {
    const { error: flipErr } = await supabase
      .from("orders")
      .update({
        status: "processing",
        payment_status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
    if (flipErr) {
      console.error("[webhooks/jkopay] order paid-flip failed:", flipErr)
    }
  } else {
    // Guard: a late / duplicate / forged FAIL callback must never clobber an
    // order that is already paid. JKOPay supports 重新付款, so an abandoned
    // first attempt's fail/expire callback can arrive AFTER a later attempt
    // (or the order_number fallback above) resolved to a now-paid order. The
    // atomic .neq(paid) leaves a paid order untouched — same guard as the
    // pchomepay #10000035 fix.
    const { data: flipped, error: flipErr } = await supabase
      .from("orders")
      .update({
        status: "failed",
        payment_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .neq("payment_status", "paid")
      .select("id")
    if (flipErr) {
      console.error("[webhooks/jkopay] order fail-flip failed:", flipErr)
    } else if (!flipped || flipped.length === 0) {
      console.warn(
        `[webhooks/jkopay] fail callback ignored for order ${orderId} (already paid) — platform_order_id=${platformOrderId}`,
      )
    }
  }

  if (success && !alreadyPaid) {
    try {
      const { enqueuePostPaymentJobs } = await import(
        "../../lib/enqueue-post-payment"
      )
      await enqueuePostPaymentJobs(orderId)
    } catch (err) {
      console.warn("[webhooks/jkopay] enqueuePostPaymentJobs failed (non-fatal):", err)
    }
  }

  res.status(200).send("OK")
})
