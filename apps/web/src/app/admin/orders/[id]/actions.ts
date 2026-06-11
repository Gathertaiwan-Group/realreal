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
