import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { enqueuePostPaymentJobs } from "../lib/enqueue-post-payment"
import { inventoryQueue } from "../lib/queue"
import { voidInvoice } from "../lib/amego"
import { cancelEcpayLogistics } from "../lib/ecpay-logistics"
import { refundPayment } from "../lib/refund-payment"
import { refundOrderPoints } from "../lib/points"

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

// PATCH /admin/orders/:id/status — update order status (admin only)
adminOrdersRouter.patch("/:id/status", async (req, res) => {
  const parsed = updateStatusSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status", details: parsed.error.flatten() }); return
  }

  const orderId = req.params.id
  const newStatus = parsed.data.status

  // Fetch current order to validate transition and handle payment_status
  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, status, payment_status")
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
    .select("id, status, payment_status, updated_at")
    .single()

  if (updateError) {
    console.error("[admin/orders] status update failed:", updateError)
    res.status(500).json({ error: "Failed to update order status" }); return
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
    .select("id, payment_status")
    .eq("id", orderId)
    .single()
  if (!order) { res.status(404).json({ error: "Order not found" }); return }
  if (order.payment_status !== "paid") {
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
      "create-shipment",
      { orderId },
      { attempts: 3, backoff: { type: "exponential", delay: 30000 } },
    )
    res.json({ ok: true, message: "Shipment job re-enqueued" })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: "enqueue failed", detail })
  }
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

  // One round-trip: order + invoices + logistics. The `invoices` table has
  // two FKs to orders (order_id + a refund_for_order_id in older schemas),
  // so we disambiguate per CLAUDE memory.
  type OrderRow = {
    id: string
    user_id: string | null
    status: string
    payment_status: string | null
    payment_method: string | null
    total: number | string | null
    gateway_tx_id: string | null
    invoices:
      | Array<{ id: string; status: string | null; amego_id: string | null }>
      | { id: string; status: string | null; amego_id: string | null }
      | null
    logistics:
      | Array<{
          id: string
          status: string | null
          type: string | null
          ecpay_logistics_id: string | null
          delivered_at: string | null
          raw_response: Record<string, unknown> | null
        }>
      | {
          id: string
          status: string | null
          type: string | null
          ecpay_logistics_id: string | null
          delivered_at: string | null
          raw_response: Record<string, unknown> | null
        }
      | null
  }

  const { data: orderRaw, error: fetchError } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, payment_status, payment_method, total, gateway_tx_id, " +
        "invoices!invoices_order_id_fkey(id, status, amego_id), " +
        "logistics(id, status, type, ecpay_logistics_id, delivered_at, raw_response)",
    )
    .eq("id", orderId)
    .single()

  if (fetchError || !orderRaw) {
    res.status(404).json({ error: "Order not found" }); return
  }

  const order = orderRaw as unknown as OrderRow

  if (!CANCELLABLE_STATUSES.includes(order.status as (typeof CANCELLABLE_STATUSES)[number])) {
    res.status(400).json({ error: `status=${order.status} 不可取消` }); return
  }

  const actions: Record<string, { ok: boolean; message: string }> = {
    invoice_void: { ok: false, message: "" },
    logistics_cancel: { ok: false, message: "" },
    payment_refund: { ok: false, message: "" },
    points_refund: { ok: false, message: "" },
    status_update: { ok: false, message: "" },
  }

  // Step 1 — 作廢發票
  const invoice = Array.isArray(order.invoices)
    ? order.invoices[0]
    : order.invoices
  if (invoice && invoice.status === "issued" && invoice.amego_id) {
    try {
      await voidInvoice(invoice.amego_id, reason)
      const { error: invUpdateError } = await supabase
        .from("invoices")
        .update({
          status: "voided",
          voided_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", invoice.id)
      if (invUpdateError) throw new Error(invUpdateError.message)
      actions.invoice_void = { ok: true, message: "已作廢 Amego 發票" }
    } catch (err) {
      actions.invoice_void = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  } else {
    actions.invoice_void = { ok: true, message: "無發票需作廢" }
  }

  // Step 2 — 取消綠界物流
  const logistics = Array.isArray(order.logistics)
    ? order.logistics[0]
    : order.logistics
  if (
    logistics &&
    !logistics.delivered_at &&
    logistics.ecpay_logistics_id
  ) {
    try {
      const r = await cancelEcpayLogistics({
        ecpay_logistics_id: logistics.ecpay_logistics_id,
        type: logistics.type ?? "",
        raw_response: logistics.raw_response,
      })
      const existingRaw = (logistics.raw_response ?? {}) as Record<string, unknown>
      await supabase
        .from("logistics")
        .update({
          status: "cancelled",
          raw_response: { ...existingRaw, cancel_response: r.raw },
        })
        .eq("id", logistics.id)
      actions.logistics_cancel = r.ok
        ? { ok: true, message: "綠界物流已取消" }
        : {
            ok: false,
            message: `綠界拒絕：${r.message}（多半因物流商已收件，需客服處理）`,
          }
    } catch (err) {
      actions.logistics_cancel = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  } else {
    actions.logistics_cancel = { ok: true, message: "無物流需取消" }
  }

  // Step 3 — 退款（v1 = mark refund_requested + email admin）
  if (order.payment_status === "paid") {
    try {
      actions.payment_refund = await refundPayment(
        {
          id: order.id,
          payment_method: order.payment_method,
          total: order.total,
          gateway_tx_id: order.gateway_tx_id,
        },
        reason,
      )
    } catch (err) {
      actions.payment_refund = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  } else {
    actions.payment_refund = { ok: true, message: "未付款，無需退款" }
  }

  // Step 4.5 — refund points (earned reverted + redeemed returned)
  if (order.user_id) {
    try {
      const r = await refundOrderPoints(orderId, order.user_id)
      actions.points_refund = {
        ok: true,
        message: `返還 ${r.redeemed_returned} 點、扣除 ${r.earned_reverted} 點回饋`,
      }
    } catch (err) {
      actions.points_refund = {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  } else {
    actions.points_refund = { ok: true, message: "無會員，無點數需返還" }
  }

  // Step 4 — 翻 status（always runs, even if every previous step failed,
  // so admin at least sees the cancel mark).
  try {
    const update: Record<string, unknown> = {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    }
    if (order.payment_status === "paid") {
      update.payment_status = "refunded"
    }
    const { error: statusError } = await supabase
      .from("orders")
      .update(update)
      .eq("id", orderId)
    if (statusError) throw new Error(statusError.message)
    actions.status_update = { ok: true, message: "訂單狀態已標記取消" }
  } catch (err) {
    actions.status_update = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }
  }

  res.json({ ok: true, actions })
})
