import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { enqueuePostPaymentJobs } from "../lib/enqueue-post-payment"
import { inventoryQueue } from "../lib/queue"

export const adminOrdersRouter = Router()

adminOrdersRouter.use(requireAuth, requireAdmin)

const VALID_STATUSES = ["pending", "processing", "shipped", "completed", "cancelled", "failed"] as const

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
