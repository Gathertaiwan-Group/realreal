import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { enqueuePostPaymentJobs } from "../lib/enqueue-post-payment"
import { inventoryQueue } from "../lib/queue"
import { refundOrderPoints } from "../lib/points"
import { decrementSpendOnRefund } from "../lib/tier"
import { restoreOrderStock, refundCouponUsage, cancelOrderById } from "../lib/cancel-order"
import { renderAndSendEmail } from "../workers/email-sender"
import { sendEmail, parseRecipients } from "../lib/email"
import { getSetting } from "../lib/settings"

export const adminOrdersRouter = Router()

adminOrdersRouter.use(requireAuth, requireAdmin)

const VALID_STATUSES = ["pending", "processing", "shipped", "completed", "cancelled", "failed"] as const

// Statuses an admin is allowed to cancel from. `completed` orders need a
// proper refund/return flow (out of scope per spec); already-`cancelled` /
// `failed` orders have nothing left to cancel.
const CANCELLABLE_STATUSES = ["pending", "processing", "shipped"] as const

const updateStatusSchema = z.object({
  status: z.enum(VALID_STATUSES),
})

// restoreOrderStock + refundCouponUsage now live in lib/cancel-order.ts (shared
// with the member self-cancel endpoint); imported above.

// PATCH /admin/orders/:id/status — update order status (admin only)
adminOrdersRouter.patch("/:id/status", async (req, res) => {
  const parsed = updateStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status", details: parsed.error.flatten() }); return
  }

  const orderId = req.params.id
  const newStatus = parsed.data.status

  // Fetch current order to validate transition and handle payment_status.
  // Include `total` so decrementSpendOnRefund knows the TWD amount on cancel.
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, payment_status, total")
    .eq("id", orderId)
    .single()

  if (fetchError || !order) {
    res.status(404).json({ error: "Order not found" }); return
  }

  // Build update payload
  const update: Record<string, string> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }

  // When admin confirms payment manually, also set payment_status to 'paid'
  if (newStatus === "processing" && order.payment_status !== "paid") {
    update.payment_status = "paid"
  }

  // When cancelling an order that was already paid, set payment_status to 'refunded'
  if (newStatus === "cancelled" && order.payment_status === "paid") {
    update.payment_status = "refunded"
  }

  const { data: updated, error: updateError } = await supabase
    .from("orders")
    .update(update)
    .eq("id", orderId)
    .select("id, status, payment_status, updated_at, user_id")
    .single()

  if (updateError) {
    console.error("[admin/orders] status update failed:", updateError)
    res.status(500).json({ error: "Failed to update order status" }); return
  }

  // If we just cancelled a previously-paid order, run the refund chain so
  // points get returned + spend mirrors decremented. Both refundOrderPoints
  // and decrementSpendOnRefund are idempotent (skip on prior refund row /
  // sentinel). Audit (round 1 + round 2) flagged both as critical:
  // points was missed by PATCH/bulk-status; spend mirror reversal was missed
  // by all three cancel paths.
  if (newStatus === "cancelled" && order.payment_status === "paid" && (updated as any).user_id) {
    try {
      await refundOrderPoints(orderId, (updated as any).user_id)
    } catch (err) {
      console.warn("[admin/orders] refundOrderPoints failed (non-fatal):", err)
    }
    try {
      const totalTwd = Number(order.total ?? 0)
      await decrementSpendOnRefund(orderId, (updated as any).user_id, totalTwd)
    } catch (err) {
      console.warn("[admin/orders] decrementSpendOnRefund failed (non-fatal):", err)
    }
  }

  // Restore stock + return coupon usage when transitioning into cancelled (the
  // order.status !== "cancelled" check makes both idempotent against repeated
  // cancels; refundCouponUsage is also self-idempotent via its row delete).
  if (newStatus === "cancelled" && order.status !== "cancelled") {
    await restoreOrderStock(orderId)
    await refundCouponUsage(orderId)
  }

  res.json({ data: updated })
})

// POST /admin/orders/bulk-status — bulk update order statuses (admin only)
adminOrdersRouter.post("/bulk-status", async (req, res) => {
  const schema = z.object({
    ids: z.array(z.string().uuid()).min(1),
    status: z.enum(VALID_STATUSES),
  })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() }); return
  }

  const { ids, status: newStatus } = parsed.data

  // For cancellation with refund, we need to check each order's payment_status
  if (newStatus === "cancelled") {
    // Snapshot orders not already cancelled so we restore their stock exactly
    // once (idempotency guard against re-cancelling).
    const { data: toRestore } = await supabase
      .from("orders")
      .select("id")
      .in("id", ids)
      .neq("status", "cancelled")

    // Snapshot previously-paid orders BEFORE updating so we can run the
    // refund chain on them after the status flip. Audit round 1 flagged
    // missing refundOrderPoints; round 2 flagged missing spend mirror
    // decrement — both fixed here. Include total for decrementSpendOnRefund.
    const { data: paidOrders } = await supabase
      .from("orders")
      .select("id, user_id, total")
      .in("id", ids)
      .eq("payment_status", "paid")

    // Update paid orders to refunded
    await supabase
      .from("orders")
      .update({ status: newStatus, payment_status: "refunded", updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("payment_status", "paid")

    // Update non-paid orders normally
    await supabase
      .from("orders")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .in("id", ids)
      .neq("payment_status", "paid")

    // Run refund chain on previously-paid orders. Both helpers idempotent
    // per-order (ledger SELECT-first + spend_decremented_at sentinel).
    type PaidRow = { id: string; user_id: string | null; total: number | string | null }
    for (const o of (paidOrders ?? []) as PaidRow[]) {
      if (!o.user_id) continue
      try {
        await refundOrderPoints(o.id, o.user_id)
      } catch (err) {
        console.warn(`[admin/orders bulk] refundOrderPoints failed for ${o.id}:`, err)
      }
      try {
        const totalTwd = Number(o.total ?? 0)
        await decrementSpendOnRefund(o.id, o.user_id, totalTwd)
      } catch (err) {
        console.warn(`[admin/orders bulk] decrementSpendOnRefund failed for ${o.id}:`, err)
      }
    }

    // Restore stock + return coupon usage for every order that actually
    // transitioned into cancelled (same idempotency snapshot as stock).
    for (const o of (toRestore ?? []) as { id: string }[]) {
      await restoreOrderStock(o.id)
      await refundCouponUsage(o.id)
    }
  } else {
    const update: Record<string, string> = { status: newStatus, updated_at: new Date().toISOString() }
    if (newStatus === "processing") {
      update.payment_status = "paid"
    }
    await supabase
      .from("orders")
      .update(update)
      .in("id", ids)
  }

  res.json({ data: { updated: ids.length } })
})

// POST /admin/orders/:id/retry-post-payment
// Re-runs the post-payment side effects (admin email, invoice insert,
// invoice issuance enqueue, logistics enqueue, tier upgrade). All the
// underlying jobs are idempotent — invoices.insert is skipped if a row
// already exists, logistics worker checks for an existing logistics row,
// and tier upgrade is bounded by total_spend. Used to backfill orders
// that paid before a post-payment bug was fixed.
adminOrdersRouter.post("/:id/retry-post-payment", async (req, res) => {
  const orderId = req.params.id

  // Sanity check — only retry for orders that ARE paid.
  const { data: order } = await supabase
    .from("orders")
    .select("id, payment_status")
    .eq("id", orderId)
    .single()
  if (!order) { res.status(404).json({ error: "Order not found" }); return }
  if (order.payment_status !== "paid") {
    res.status(400).json({ error: `payment_status is "${order.payment_status}", must be "paid"` })
    return
  }

  try {
    await enqueuePostPaymentJobs(orderId)
    res.json({ ok: true, message: "Post-payment jobs re-enqueued" })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: "retry failed", detail })
  }
})

// POST /admin/orders/:id/retry-shipment
// Just re-enqueue the create-shipment job (without re-running emails /
// invoice / tier upgrade). The worker already short-circuits when a
// logistics row exists; this is for ECPay failures where the row is
// still missing.
adminOrdersRouter.post("/:id/retry-shipment", async (req, res) => {
  const orderId = req.params.id

  const { data: order } = await supabase
    .from("orders")
    .select("id, payment_status, payment_method")
    .eq("id", orderId)
    .single()
  if (!order) { res.status(404).json({ error: "Order not found" }); return }
  // 超商取貨付款 (cvs_cod) collects cash at pickup, so its payment_status stays
  // "pending" until then — don't gate its retry on "paid". Prepaid methods only
  // ship once the payment has settled.
  const isCod = order.payment_method === "cvs_cod"
  if (!isCod && order.payment_status !== "paid") {
    res.status(400).json({ error: `payment_status is "${order.payment_status}", must be "paid"` })
    return
  }

  // If a logistics row already exists, the worker will short-circuit. Force
  // a retry by deleting any failed/incomplete row first so the next job
  // actually attempts ECPay again.
  await supabase
    .from("logistics")
    .delete()
    .eq("order_id", orderId)
    .is("ecpay_logistics_id", null)

  try {
    await inventoryQueue.add(
      isCod ? "create-shipment-cod" : "create-shipment",
      { orderId },
      { attempts: 3, backoff: { type: "exponential", delay: 30000 } },
    )
    res.json({ ok: true, message: "Shipment job re-enqueued" })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: "enqueue failed", detail })
  }
})

// POST /admin/orders/:id/ship — mark order as shipped and send customer email.
// Works for regular orders (status="processing") and COD orders (status="pending").
adminOrdersRouter.post("/:id/ship", async (req, res) => {
  const orderId = req.params.id

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, order_number, status, payment_method, guest_email, user_id")
    .eq("id", orderId)
    .single()

  if (error || !order) { res.status(404).json({ error: "Order not found" }); return }

  const isCod = order.payment_method === "cvs_cod"
  const canShip = order.status === "processing" || (isCod && order.status === "pending")
  if (!canShip) {
    res.status(400).json({ error: `Cannot ship order in status "${order.status}"` }); return
  }

  const { data: shippingAddr } = await supabase
    .from("order_addresses")
    .select("name")
    .eq("order_id", orderId)
    .eq("type", "shipping")
    .maybeSingle()

  const customerName = (shippingAddr?.name as string | null | undefined) ?? "顧客"

  let recipientEmail: string | undefined
  if (order.user_id) {
    try {
      const { data } = await supabase.auth.admin.getUserById(order.user_id as string)
      recipientEmail = data?.user?.email ?? undefined
    } catch { /* ignore */ }
  }
  if (!recipientEmail) recipientEmail = (order.guest_email as string | null | undefined) ?? undefined

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "shipped", updated_at: new Date().toISOString() })
    .eq("id", orderId)

  if (updateError) {
    console.error("[admin/orders] ship status update failed:", updateError)
    res.status(500).json({ error: "Failed to update order status" }); return
  }

  const emailData = { orderNumber: order.order_number as string, customerName }

  if (recipientEmail) {
    try {
      await renderAndSendEmail({
        template: "order-shipped",
        to: recipientEmail,
        data: emailData,
      })
    } catch (err) {
      console.warn(`[admin/orders] order-shipped customer email failed for ${orderId}:`, err)
    }
  }

  try {
    const settingVal = await getSetting("notifications.admin_email")
    const adminEmails = parseRecipients(settingVal ?? process.env.ADMIN_EMAIL)
    console.log(`[admin/orders] ship admin email → setting="${settingVal}" envFallback="${process.env.ADMIN_EMAIL}" resolved=${JSON.stringify(adminEmails)}`)
    if (adminEmails.length > 0) {
      const { renderOrderShipped } = await import("../emails/OrderShipped")
      const subject = `【已出貨】訂單 #${order.order_number} — ${customerName}`
      const html = renderOrderShipped(emailData)
      await sendEmail({ to: adminEmails, subject, html })
    }
  } catch (err) {
    console.warn(`[admin/orders] order-shipped admin email failed for ${orderId}:`, err)
  }

  res.json({ ok: true })
})

// POST /admin/orders/:id/cancel — one-click admin cancellation.
// Spec: docs/superpowers/specs/2026-05-30-order-state-transitions-and-cancellation.md (Section 3)
//
// Runs four independent side-effects, each with its own try/catch so that a
// failure in one step does not abort the others. The final response shape is
// always 200 with an `actions` object containing per-step `{ ok, message }`
// — the UI surfaces each line so the admin knows exactly what landed.
//
// Steps:
//   1. invoice_void     — call Amego 作廢 on any issued invoice
//   2. logistics_cancel — call ECPay LogisticsTradeCancel on uncollected logistics
//   3. payment_refund   — flip payments.status='refund_requested' + email admin
//   4. status_update    — always: orders.status='cancelled' (+ refunded if paid)
const cancelOrderSchema = z.object({
  reason: z.string().trim().min(1, "reason 必填").max(200),
})

adminOrdersRouter.post("/:id/cancel", async (req, res) => {
  const parsed = cancelOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "reason 必填", details: parsed.error.flatten() }); return
  }
  const reason = parsed.data.reason
  const orderId = req.params.id

  // Full cancellation choreography lives in lib/cancel-order.ts (shared with the
  // member self-cancel endpoint). Admin policy: cancel from pending/processing/
  // shipped.
  const out = await cancelOrderById(orderId, reason, {
    allowedStatuses: CANCELLABLE_STATUSES,
  })
  if (out.result === "not_found") {
    res.status(404).json({ error: "Order not found" }); return
  }
  if (out.result === "not_cancellable") {
    res.status(400).json({ error: `status=${out.orderStatus} 不可取消` }); return
  }
  res.json({ ok: true, actions: out.actions })
})

// DELETE /admin/orders/:id — archive (soft) or permanently remove (hard) an order.
//
// Soft delete (default): just stamp deleted_at=now() so the row disappears from
// active listings but stays fully intact (money/invoice/points/stock history is
// preserved). Reversible via POST /:id/restore. This is the SAFE default.
//
// Hard delete (?hard=true): physically removes the order and untangles the FK
// web. Heavily guarded — refused for anything that touched real money (paid /
// refunded payment, or an issued invoice) so we never destroy financial records.
// Only pending / failed / cancelled orders with no settled money can be erased.
adminOrdersRouter.delete("/:id", async (req, res) => {
  const orderId = req.params.id
  const hard = req.query.hard === "true"

  // ---- Soft delete (archive) ----
  if (!hard) {
    // Only flip rows that are still active so a double-archive is a no-op rather
    // than re-stamping a newer timestamp over an existing one.
    const { error } = await supabase
      .from("orders")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("deleted_at", null)
    if (error) {
      console.error("[admin/orders] soft delete failed:", error)
      res.status(500).json({ error: "Failed to archive order" }); return
    }
    res.json({ ok: true, mode: "archived" }); return
  }

  // ---- Hard delete (permanent) ----
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, payment_status")
    .eq("id", orderId)
    .single()
  if (fetchError || !order) {
    res.status(404).json({ error: "Order not found" }); return
  }

  // Invoices for this order — we need to know if any are already 'issued'
  // (a real tax document was emitted; that order must never be hard-deleted).
  const { data: invoiceRows, error: invFetchError } = await supabase
    .from("invoices")
    .select("status")
    .eq("order_id", orderId)
  if (invFetchError) {
    console.error("[admin/orders] hard delete invoice fetch failed:", invFetchError)
    res.status(500).json({ error: invFetchError.message, step: "fetch_invoices" }); return
  }

  // Guard: allow ONLY when no real money has settled. Refuse otherwise — the
  // SAFE choice is to keep the record and tell the admin to cancel/archive.
  const paymentSettled = order.payment_status === "paid" || order.payment_status === "refunded"
  const deletableStatus =
    order.status === "pending" || order.status === "failed" || order.status === "cancelled"
  const hasIssuedInvoice = (invoiceRows ?? []).some((inv) => inv.status === "issued")
  if (paymentSettled || !deletableStatus || hasIssuedInvoice) {
    res.status(409).json({
      error: "已付款或已開立發票的訂單無法永久刪除，請改用『取消訂單』或封存",
    }); return
  }

  // Execute in FK-safe order. After EVERY write we check .error (Supabase JS
  // fails silently) and bail with the offending step so we never half-delete.

  // 1. Restore stock ONLY for pending orders. A pending order still holds its
  //    reserved stock; a cancelled order already had it restored by the cancel
  //    flow (restoring again would oversell); a persisted 'failed' order has an
  //    ambiguous stock state so we deliberately leave it alone to avoid oversell.
  if (order.status === "pending") {
    await restoreOrderStock(orderId)
  }

  // 2. Roll back coupon usage: decrement each used coupon's used_count (floored
  //    at 0) then remove the coupon_uses rows.
  const { data: couponUses, error: cuFetchError } = await supabase
    .from("coupon_uses")
    .select("id, coupon_id")
    .eq("order_id", orderId)
  if (cuFetchError) {
    res.status(500).json({ error: cuFetchError.message, step: "fetch_coupon_uses" }); return
  }
  for (const use of (couponUses ?? []) as { id: string; coupon_id: string | null }[]) {
    if (!use.coupon_id) continue
    const { data: coupon, error: cReadError } = await supabase
      .from("coupons")
      .select("used_count")
      .eq("id", use.coupon_id)
      .single()
    if (cReadError) {
      res.status(500).json({ error: cReadError.message, step: "read_coupon_used_count" }); return
    }
    const next = Math.max(0, Number(coupon?.used_count ?? 0) - 1)
    const { error: cUpdateError } = await supabase
      .from("coupons")
      .update({ used_count: next })
      .eq("id", use.coupon_id)
    if (cUpdateError) {
      res.status(500).json({ error: cUpdateError.message, step: "decrement_coupon_used_count" }); return
    }
  }
  const { error: cuDeleteError } = await supabase
    .from("coupon_uses")
    .delete()
    .eq("order_id", orderId)
  if (cuDeleteError) {
    res.status(500).json({ error: cuDeleteError.message, step: "delete_coupon_uses" }); return
  }

  // 3. Null the parent FK (orders.invoice_id) so the invoice rows are no longer
  //    referenced and can be deleted in the next step.
  const { error: nullInvoiceFkError } = await supabase
    .from("orders")
    .update({ invoice_id: null })
    .eq("id", orderId)
  if (nullInvoiceFkError) {
    res.status(500).json({ error: nullInvoiceFkError.message, step: "null_invoice_fk" }); return
  }

  // 4. Delete invoices (only pending invoice rows can exist past the guard).
  const { error: invDeleteError } = await supabase
    .from("invoices")
    .delete()
    .eq("order_id", orderId)
  if (invDeleteError) {
    res.status(500).json({ error: invDeleteError.message, step: "delete_invoices" }); return
  }

  // 5. Delete payments.
  const { error: payDeleteError } = await supabase
    .from("payments")
    .delete()
    .eq("order_id", orderId)
  if (payDeleteError) {
    res.status(500).json({ error: payDeleteError.message, step: "delete_payments" }); return
  }

  // 6. Delete logistics.
  const { error: logDeleteError } = await supabase
    .from("logistics")
    .delete()
    .eq("order_id", orderId)
  if (logDeleteError) {
    res.status(500).json({ error: logDeleteError.message, step: "delete_logistics" }); return
  }

  // 7. Preserve subscription history: detach instead of delete.
  const { error: subDetachError } = await supabase
    .from("subscription_orders")
    .update({ order_id: null })
    .eq("order_id", orderId)
  if (subDetachError) {
    res.status(500).json({ error: subDetachError.message, step: "detach_subscription_orders" }); return
  }

  // 8. Finally delete the order itself. CASCADE clears order_items,
  //    order_addresses, and order_post_payment_log.
  const { error: orderDeleteError } = await supabase
    .from("orders")
    .delete()
    .eq("id", orderId)
  if (orderDeleteError) {
    res.status(500).json({ error: orderDeleteError.message, step: "delete_order" }); return
  }

  res.json({ ok: true, mode: "deleted" })
})

// POST /admin/orders/:id/restore — un-archive a soft-deleted order.
adminOrdersRouter.post("/:id/restore", async (req, res) => {
  const orderId = req.params.id
  const { error } = await supabase
    .from("orders")
    .update({ deleted_at: null })
    .eq("id", orderId)
  if (error) {
    console.error("[admin/orders] restore failed:", error)
    res.status(500).json({ error: "Failed to restore order" }); return
  }
  res.json({ ok: true })
})
