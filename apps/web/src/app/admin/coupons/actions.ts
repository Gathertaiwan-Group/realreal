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

export async function createCouponAction(
  input: CreateCouponInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  // Return a structured result instead of throwing: a thrown server-action
  // error is masked by Next.js production into the generic error.tsx page
  // (錯誤代碼 digest), hiding the real cause. The form surfaces this string.
  try {
    await apiClient("/admin/coupons", {
      method: "POST",
      body: JSON.stringify(input),
      token: session?.access_token,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "建立折扣碼失敗" }
  }
  revalidatePath("/admin/coupons")
  return { ok: true }
}
