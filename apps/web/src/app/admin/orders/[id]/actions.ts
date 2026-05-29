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
