import { supabase } from "./supabase"
import { voidInvoice } from "./amego"
import { cancelEcpayLogistics } from "./ecpay-logistics"
import { refundPayment } from "./refund-payment"
import { refundOrderPoints } from "./points"
import { decrementSpendOnRefund } from "./tier"

/**
 * Shared order-cancellation choreography.
 *
 * Extracted verbatim from the admin `POST /admin/orders/:id/cancel` handler so
 * both the admin endpoint and the member self-cancel endpoint
 * (`POST /orders/:id/cancel`) run the SAME side-effect reversal. The status
 * policy gate differs per caller (admin: pending/processing/shipped; member:
 * pending/processing) and is passed in via `opts.allowedStatuses` — this
 * function itself does not decide who may cancel, only how to cancel.
 *
 * Every step has its own try/catch so one failure never aborts the others; the
 * status flip always runs last so the order is at least marked cancelled.
 */

export type CancelAction = { ok: boolean; message: string }
export type CancelActions = {
  invoice_void: CancelAction
  logistics_cancel: CancelAction
  payment_refund: CancelAction
  points_refund: CancelAction
  status_update: CancelAction
}

export type CancelOrderResult =
  | { result: "not_found"; actions: CancelActions }
  | { result: "not_cancellable"; orderStatus: string; actions: CancelActions }
  | { result: "cancelled"; orderStatus: string; wasPaid: boolean; actions: CancelActions }

function emptyActions(): CancelActions {
  return {
    invoice_void: { ok: false, message: "" },
    logistics_cancel: { ok: false, message: "" },
    payment_refund: { ok: false, message: "" },
    points_refund: { ok: false, message: "" },
    status_update: { ok: false, message: "" },
  }
}

/**
 * Return the stock that order creation deducted (atomic_deduct_stock). Call
 * ONLY when an order transitions INTO cancelled from a non-cancelled state —
 * the caller's prior-status check is the idempotency guard (avoids double
 * restore on a repeated cancel). Non-fatal: logs and continues on failure.
 */
export async function restoreOrderStock(orderId: string): Promise<void> {
  const { data: items } = await supabase
    .from("order_items")
    .select("variant_id, qty")
    .eq("order_id", orderId)
  const variants = (items ?? [])
    .filter((i) => i.variant_id && Number(i.qty) > 0)
    .map((i) => ({ id: i.variant_id, qty: Number(i.qty) }))
  if (variants.length === 0) return
  const { error } = await supabase.rpc("atomic_restore_stock", { p_variants: variants })
  if (error) console.warn(`[cancel-order] restore stock failed for ${orderId} (non-fatal):`, error.message)
}

/**
 * Return the coupon usage an order consumed at checkout. For every coupon_uses
 * row tied to this order we decrement the coupon's used_count (RPC floors at 0)
 * then delete the coupon_uses rows, so the customer's use no longer counts
 * against max_uses. Call ONLY when an order transitions into cancelled/refunded;
 * non-fatal (logs and continues).
 *
 * Idempotent: the final delete removes the rows, so a second run finds nothing
 * to decrement — a double-cancel can't over-decrement used_count.
 */
export async function refundCouponUsage(orderId: string): Promise<void> {
  const { data: uses, error: fetchError } = await supabase
    .from("coupon_uses")
    .select("id, coupon_id")
    .eq("order_id", orderId)
  if (fetchError) {
    console.warn(`[cancel-order] refundCouponUsage fetch failed for ${orderId} (non-fatal):`, fetchError.message)
    return
  }
  const rows = (uses ?? []) as { id: string; coupon_id: string | null }[]
  if (rows.length === 0) return

  for (const use of rows) {
    if (!use.coupon_id) continue
    const { error: rpcError } = await supabase.rpc("atomic_decrement_coupon_usage", {
      p_coupon_id: use.coupon_id,
    })
    if (rpcError) {
      console.warn(
        `[cancel-order] atomic_decrement_coupon_usage failed for coupon ${use.coupon_id} (order ${orderId}, non-fatal):`,
        rpcError.message,
      )
    }
  }

  const { error: deleteError } = await supabase
    .from("coupon_uses")
    .delete()
    .eq("order_id", orderId)
  if (deleteError) {
    console.warn(`[cancel-order] refundCouponUsage delete failed for ${orderId} (non-fatal):`, deleteError.message)
  }
}

/**
 * Release the first-purchase discount an order claimed at checkout, so a
 * customer whose order never completed can claim it again on their next try.
 *
 * `orders.first_purchase_applied` is guarded by the partial unique index
 * `uniq_first_purchase_per_user` (migration 0028) — one claimed order per
 * user. That means a claim left behind on a dead order doesn't merely mislead
 * the first-purchase check, it makes the discount **unclaimable forever**: the
 * index rejects the next order that tries to set the flag.
 *
 * Reported 2026-08-30: a customer picked the wrong payment method, the order
 * failed, and her NT$50 first-purchase discount vanished with it — NT$0 spent,
 * yet no longer eligible. Call this whenever an order transitions to
 * failed/cancelled.
 *
 * Idempotent (setting false twice is harmless) and non-fatal: losing this
 * cleanup must never block a cancellation, so it logs and continues.
 */
export async function releaseFirstPurchaseClaim(orderId: string): Promise<void> {
  const { error } = await supabase
    .from("orders")
    .update({ first_purchase_applied: false })
    .eq("id", orderId)
    .eq("first_purchase_applied", true)
  if (error) {
    console.warn(
      `[cancel-order] releaseFirstPurchaseClaim failed for ${orderId} (non-fatal):`,
      error.message,
    )
  }
}

type OrderRow = {
  id: string
  user_id: string | null
  status: string
  payment_status: string | null
  payment_method: string | null
  total: number | string | null
  payments:
    | Array<{ gateway_tx_id: string | null }>
    | { gateway_tx_id: string | null }
    | null
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
        cvs_payment_no: string | null
        cvs_validation_no: string | null
        delivered_at: string | null
        raw_response: Record<string, unknown> | null
      }>
    | {
        id: string
        status: string | null
        type: string | null
        ecpay_logistics_id: string | null
        cvs_payment_no: string | null
        cvs_validation_no: string | null
        delivered_at: string | null
        raw_response: Record<string, unknown> | null
      }
    | null
}

export async function cancelOrderById(
  orderId: string,
  reason: string,
  opts: { allowedStatuses: readonly string[] },
): Promise<CancelOrderResult> {
  // One round-trip: order + invoices + logistics + payments (gateway_tx_id lives
  // on payments, NOT orders). invoices has two FKs to orders, so disambiguate.
  const { data: orderRaw, error: fetchError } = await supabase
    .from("orders")
    .select(
      "id, user_id, status, payment_status, payment_method, total, " +
        "payments(gateway_tx_id), " +
        "invoices!invoices_order_id_fkey(id, status, amego_id), " +
        "logistics(id, status, type, ecpay_logistics_id, cvs_payment_no, cvs_validation_no, delivered_at, raw_response)",
    )
    .eq("id", orderId)
    .single()

  if (fetchError) console.error("[cancel-order] order fetch failed:", fetchError)
  if (fetchError || !orderRaw) {
    return { result: "not_found", actions: emptyActions() }
  }

  const order = orderRaw as unknown as OrderRow
  const paymentGatewayTxId = Array.isArray(order.payments)
    ? order.payments[0]?.gateway_tx_id ?? null
    : order.payments?.gateway_tx_id ?? null

  if (!opts.allowedStatuses.includes(order.status)) {
    return { result: "not_cancellable", orderStatus: order.status, actions: emptyActions() }
  }

  const actions = emptyActions()

  // Step 1 — 作廢發票
  const invoice = Array.isArray(order.invoices) ? order.invoices[0] : order.invoices
  if (invoice && invoice.status === "issued" && invoice.amego_id) {
    try {
      await voidInvoice(invoice.amego_id, reason)
      const { error: invUpdateError } = await supabase
        .from("invoices")
        .update({ status: "voided", voided_at: new Date().toISOString(), error_message: null })
        .eq("id", invoice.id)
      if (invUpdateError) throw new Error(invUpdateError.message)
      actions.invoice_void = { ok: true, message: "已作廢 Amego 發票" }
    } catch (err) {
      actions.invoice_void = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  } else {
    actions.invoice_void = { ok: true, message: "無發票需作廢" }
  }

  // Step 2 — 取消綠界物流
  const logistics = Array.isArray(order.logistics) ? order.logistics[0] : order.logistics
  if (logistics && !logistics.delivered_at && logistics.ecpay_logistics_id) {
    try {
      const r = await cancelEcpayLogistics({
        ecpay_logistics_id: logistics.ecpay_logistics_id,
        type: logistics.type ?? "",
        cvs_payment_no: logistics.cvs_payment_no,
        cvs_validation_no: logistics.cvs_validation_no,
        raw_response: logistics.raw_response,
      })
      const existingRaw = (logistics.raw_response ?? {}) as Record<string, unknown>
      await supabase
        .from("logistics")
        .update({ status: "cancelled", raw_response: { ...existingRaw, cancel_response: r.raw } })
        .eq("id", logistics.id)
      actions.logistics_cancel = r.ok
        ? { ok: true, message: "綠界物流已取消" }
        : { ok: false, message: `綠界拒絕：${r.message}（多半因物流商已收件，需客服處理）` }
    } catch (err) {
      actions.logistics_cancel = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  } else {
    actions.logistics_cancel = { ok: true, message: "無物流需取消" }
  }

  // Step 3 — 退款（v1 = mark refund_requested + email admin）
  if (order.payment_status === "paid") {
    try {
      actions.payment_refund = await refundPayment(
        { id: order.id, payment_method: order.payment_method, total: order.total, gateway_tx_id: paymentGatewayTxId },
        reason,
      )
    } catch (err) {
      actions.payment_refund = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  } else {
    actions.payment_refund = { ok: true, message: "未付款，無需退款" }
  }

  // Step 4.5 — refund points (earned reverted + redeemed returned) AND decrement
  // spend mirrors. Both helpers are idempotent. Spend reversal stays even when
  // payment_status wasn't paid because the increment side runs the same way.
  if (order.user_id) {
    try {
      const r = await refundOrderPoints(orderId, order.user_id)
      actions.points_refund = {
        ok: true,
        message: `返還 ${r.redeemed_returned} 點、扣除 ${r.earned_reverted} 點回饋`,
      }
    } catch (err) {
      actions.points_refund = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
    try {
      const totalTwd = Number(order.total ?? 0)
      const d = await decrementSpendOnRefund(orderId, order.user_id, totalTwd)
      if (d.decremented) {
        console.log(
          `[cancel-order] spend reversed for ${orderId}: total -${d.total_spend_delta}, period -${d.period_spend_delta}, charity -${d.charity_delta}`,
        )
      }
    } catch (err) {
      console.warn("[cancel-order] decrementSpendOnRefund failed (non-fatal):", err)
    }
  } else {
    actions.points_refund = { ok: true, message: "無會員，無點數需返還" }
  }

  // Step 4 — 翻 status（always runs, even if every previous step failed）
  let statusFlipped = false
  try {
    const update: Record<string, unknown> = {
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    }
    if (order.payment_status === "paid") {
      update.payment_status = "refunded"
    } else if (order.payment_status === "pending") {
      // Never actually paid — leaving payment_status="pending" on a cancelled
      // order reads as "cancelled AND still awaiting payment" (confusing on
      // the admin order page, and it also kept the order matching the
      // pending/paid filters other code uses to decide what's still "live").
      update.payment_status = "failed"
    }
    const { error: statusError } = await supabase.from("orders").update(update).eq("id", orderId)
    if (statusError) throw new Error(statusError.message)
    statusFlipped = true
    actions.status_update = { ok: true, message: "訂單狀態已標記取消" }
  } catch (err) {
    actions.status_update = { ok: false, message: err instanceof Error ? err.message : String(err) }
  }

  // Step 5 — stock restore + coupon-usage reversal.
  //
  // These two are documented non-fatal (they log and continue), so they MUST NOT
  // share the status_update try/catch: a throw escaping either one used to
  // overwrite the already-set { ok: true, "訂單狀態已標記取消" } with { ok: false },
  // reporting a failed cancellation to the admin even though the orders row had
  // already been flipped and committed. Each gets its own guard instead.
  //
  // Gated on statusFlipped so the previous behaviour is preserved exactly: when
  // the status flip fails the order is NOT cancelled, and restoring its stock
  // would oversell.  order.status was guaranteed non-cancelled by the
  // allowedStatuses gate above, so each of these runs exactly once per order.
  if (statusFlipped) {
    try {
      await restoreOrderStock(orderId)
    } catch (err) {
      console.warn(`[cancel-order] restoreOrderStock threw for ${orderId} (non-fatal):`, err)
    }
    try {
      await refundCouponUsage(orderId)
    } catch (err) {
      console.warn(`[cancel-order] refundCouponUsage threw for ${orderId} (non-fatal):`, err)
    }
    try {
      await releaseFirstPurchaseClaim(orderId)
    } catch (err) {
      console.warn(`[cancel-order] releaseFirstPurchaseClaim threw for ${orderId} (non-fatal):`, err)
    }
  }

  return {
    result: "cancelled",
    orderStatus: order.status,
    wasPaid: order.payment_status === "paid",
    actions,
  }
}
