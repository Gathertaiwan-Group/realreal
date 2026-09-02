"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"

// All actions return { ok, error? } instead of throwing: Next.js masks errors
// thrown inside server actions in production ("An error occurred in the Server
// Components render…"), which hides the real failure from the admin. Returned
// values pass through unmasked.
export type ActionResult = { ok: boolean; error?: string }

function toErrorResult(e: unknown): ActionResult {
  const raw = e instanceof Error ? e.message : String(e)
  // apiClient throws "[409] <message>" / "[500] <message>". Strip the leading
  // status prefix so the UI can toast the clean message (e.g. the 409 copy
  // "已付款或已開立發票的訂單無法永久刪除…") without a "[409]" in front.
  const message = raw.replace(/^\[\d{3}\]\s*/, "")
  return { ok: false, error: message }
}

export async function updateOrderStatusAction(
  id: string,
  status: string,
): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${id}`)
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

/**
 * Confirm payment on an order whose status must NOT move — specifically
 * 超商取貨付款 collected at the store after shipping. Sets payment_status=paid
 * and runs the post-payment pipeline (invoice / points / tier / 付款確認信).
 *
 * Manually-shipped COD orders never get the ECPay delivered webhook, so without
 * this they stay 'pending' forever and never produce an invoice.
 */
export async function confirmPaymentAction(orderId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/orders/${orderId}/confirm-payment`, {
      method: "POST",
      body: JSON.stringify({}),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

// ---------------------------------------------------------------------------
// Invoice actions — re-enqueue and void via the existing API. Path is
// revalidated so the page re-fetches the invoice row after each call.
// ---------------------------------------------------------------------------

export async function reissueInvoiceAction(
  orderId: string,
  invoiceId: string,
): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/invoices/${invoiceId}/reissue`, {
      method: "POST",
      body: JSON.stringify({}),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

/**
 * Re-run the post-payment pipeline for every paid order that never completed
 * it — invoice, 消費累積, 點數, 會員等級. Only touches orders with no
 * tier_incremented_at sentinel, and every underlying job is idempotent.
 *
 * For 超商取貨付款 orders the pipeline skips the customer 付款確認信, so
 * draining that backlog does not email anyone.
 */
export async function retryPostPaymentBatchAction(): Promise<
  ActionResult & { processed?: number; skippedAlreadyDone?: number }
> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const result = await apiClient<{ processed: number; skippedAlreadyDone: number }>(
      "/admin/orders/retry-post-payment-batch",
      { method: "POST", body: JSON.stringify({}), token: session?.access_token },
    )
    revalidatePath("/admin/orders")
    return { ok: true, processed: result.processed, skippedAlreadyDone: result.skippedAlreadyDone }
  } catch (e) {
    return toErrorResult(e)
  }
}

/**
 * Re-drive every unissued invoice at once.
 *
 * When Amego's 字軌 runs out, the whole backlog fails together and each one
 * needs re-driving by hand — 45 invoices sat stranded for 11 days after
 * 2026-08-20. Legacy WordPress orders are held back by the API unless
 * includeLegacy is set: those were invoiced on the old platform before the
 * 2026-06-29 import, so re-issuing would duplicate a real invoice.
 */
export async function reissueAllInvoicesAction(
  opts: { includeLegacy?: boolean } = {},
): Promise<ActionResult & { enqueued?: number; skippedLegacy?: number }> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const result = await apiClient<{ enqueued: number; skippedLegacy: number }>(
      "/admin/invoices/reissue-batch",
      {
        method: "POST",
        body: JSON.stringify({ includeLegacy: opts.includeLegacy ?? false }),
        token: session?.access_token,
      },
    )
    revalidatePath("/admin/orders")
    return { ok: true, enqueued: result.enqueued, skippedLegacy: result.skippedLegacy }
  } catch (e) {
    return toErrorResult(e)
  }
}

/**
 * 批次出貨：把一份指名的訂單清單標記為已出貨並寄出通知信。
 *
 * 出貨日一次就是 ~30 筆，逐筆點進去按「出貨」是漏單的來源。清單一律由使用者
 * 指定，API 不會自己挑訂單 —— 2026-08-31 就是一個自己挑範圍的批次，寄了 20 封
 * 錯誤的付款通知給幾個月前就收到貨的客人。
 */
export async function shipBatchAction(
  orderNumbers: string[],
): Promise<
  ActionResult & {
    shipped?: string[]
    skipped?: Array<{ orderNumber: string; reason: string }>
  }
> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const result = await apiClient<{
      shipped: string[]
      skipped: Array<{ orderNumber: string; reason: string }>
    }>("/admin/orders/ship-batch", {
      method: "POST",
      body: JSON.stringify({ orderNumbers }),
      token: session?.access_token,
    })
    revalidatePath("/admin/orders")
    return { ok: true, shipped: result.shipped, skipped: result.skipped }
  } catch (e) {
    return toErrorResult(e)
  }
}

/**
 * 作廢 WP 舊站訂單被重複開立的發票。
 *
 * WP 開頭的訂單是 2026-06-29 搬站前的 WordPress 訂單，發票在舊平台就開過了。
 * 2026-08-31 的補算批次跑過付款後流程，替這些訂單又開了 11 張真發票。範圍由
 * 規則決定（狀態 issued 且訂單編號以 WP 開頭），按鈕指不到任何一筆新站訂單。
 */
export async function voidLegacyDuplicateInvoicesAction(): Promise<
  ActionResult & {
    voided?: Array<{ orderNumber: string; invoiceNumber: string; amount: number }>
    failed?: Array<{ orderNumber: string; invoiceNumber: string; error: string }>
  }
> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const result = await apiClient<{
      voided: Array<{ orderNumber: string; invoiceNumber: string; amount: number }>
      failed: Array<{ orderNumber: string; invoiceNumber: string; error: string }>
    }>("/admin/invoices/void-legacy-duplicates", {
      method: "POST",
      body: JSON.stringify({ reason: "舊站訂單重複開立" }),
      token: session?.access_token,
    })
    revalidatePath("/admin/orders")
    return { ok: true, voided: result.voided, failed: result.failed }
  } catch (e) {
    return toErrorResult(e)
  }
}

export async function voidInvoiceAction(
  orderId: string,
  invoiceId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/invoices/${invoiceId}/void`, {
      method: "POST",
      body: JSON.stringify({ reason }),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

export async function shipOrderAction(orderId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/orders/${orderId}/ship`, {
      method: "POST",
      body: JSON.stringify({}),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

export async function retryShipmentAction(orderId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/orders/${orderId}/retry-shipment`, {
      method: "POST",
      body: JSON.stringify({}),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

// Re-run the full post-payment pipeline (customer 付款確認信 + admin 通知 + LINE +
// 發票 + 點數 + 升等 + 物流) for an already-paid order. The API endpoint requires
// payment_status='paid' and every job is idempotent (SELECT-first / sentinel),
// so re-running only fills the gaps — EXCEPT the customer email, which re-sends.
// Used to recover orders that were flipped to paid without the pipeline running
// (e.g. manually confirmed before the confirm→enqueue fix, or a transient
// enqueue failure on the 2026-07-12 pchomepay incident — order #10000038).
export async function retryPostPaymentAction(orderId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/orders/${orderId}/retry-post-payment`, {
      method: "POST",
      body: JSON.stringify({}),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

// ---------------------------------------------------------------------------
// Cancel order — atomic multi-step server action that voids the invoice,
// cancels the ECPay logistics shipment, flags the payment for refund, refunds
// points, and flips order.status to cancelled. The API returns per-step
// results in `actions` so the UI can render success/warning per side-effect.
// ---------------------------------------------------------------------------

export async function cancelOrderAction(orderId: string, reason: string) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const data = await apiClient(`/admin/orders/${orderId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return data
  } catch (e) {
    return toErrorResult(e)
  }
}

// ---------------------------------------------------------------------------
// Delete order — soft archive (sets orders.deleted_at) by default, or a hard
// permanent purge when { hard: true }. The API rejects hard-deleting paid /
// invoiced orders with a 409, which apiClient surfaces as a thrown
// "[409] <message>"; we strip the status prefix so the UI can toast the clean
// Chinese message. Both the detail path and the list are revalidated because a
// soft-archived / purged order should disappear from the active list.
// ---------------------------------------------------------------------------

export async function deleteOrderAction(
  orderId: string,
  { hard }: { hard: boolean },
): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const path = hard
      ? `/admin/orders/${orderId}?hard=true`
      : `/admin/orders/${orderId}`
    await apiClient(path, {
      method: "DELETE",
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath("/admin/orders")
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}

export async function restoreOrderAction(orderId: string): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()
    await apiClient(`/admin/orders/${orderId}/restore`, {
      method: "POST",
      body: JSON.stringify({}),
      token: session?.access_token,
    })
    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath("/admin/orders")
    return { ok: true }
  } catch (e) {
    return toErrorResult(e)
  }
}
