"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"

export async function updateOrderStatusAction(id: string, status: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  await apiClient(`/admin/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
    token: session?.access_token,
  })
  revalidatePath(`/admin/orders/${id}`)
}

// ---------------------------------------------------------------------------
// Invoice actions — re-enqueue and void via the existing API. Path is
// revalidated so the page re-fetches the invoice row after each call.
// ---------------------------------------------------------------------------

export async function reissueInvoiceAction(orderId: string, invoiceId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  await apiClient(`/admin/invoices/${invoiceId}/reissue`, {
    method: "POST",
    body: JSON.stringify({}),
    token: session?.access_token,
  })
  revalidatePath(`/admin/orders/${orderId}`)
}

export async function voidInvoiceAction(
  orderId: string,
  invoiceId: string,
  reason: string,
) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  await apiClient(`/admin/invoices/${invoiceId}/void`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    token: session?.access_token,
  })
  revalidatePath(`/admin/orders/${orderId}`)
}

export async function retryShipmentAction(orderId: string) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  await apiClient(`/admin/orders/${orderId}/retry-shipment`, {
    method: "POST",
    body: JSON.stringify({}),
    token: session?.access_token,
  })
  revalidatePath(`/admin/orders/${orderId}`)
}
