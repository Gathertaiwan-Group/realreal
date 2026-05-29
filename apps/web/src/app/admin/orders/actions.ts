"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"

async function getToken() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token
}

export async function updateOrderStatusAction(id: string, status: string) {
  await apiClient(`/admin/orders/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
    token: await getToken(),
  })
  revalidatePath("/admin/orders")
  revalidatePath(`/admin/orders/${id}`)
}

export async function bulkUpdateOrderStatusAction(ids: string[], status: string) {
  await apiClient("/admin/orders/bulk-status", {
    method: "POST",
    body: JSON.stringify({ ids, status }),
    token: await getToken(),
  })
  revalidatePath("/admin/orders")
}
