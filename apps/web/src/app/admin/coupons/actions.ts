"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"

interface CreateCouponInput {
  code: string
  type: string
  value: number
  max_uses: number | null
  expires_at: string | null
  tier_id: string | null
}

export async function createCouponAction(input: CreateCouponInput) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  await apiClient("/admin/coupons", {
    method: "POST",
    body: JSON.stringify(input),
    token: session?.access_token,
  })
  revalidatePath("/admin/coupons")
}
