"use server"

/**
 * Server actions for the customer detail page.
 *
 * Spec: docs/superpowers/specs/2026-05-30-points-tiers-customer-detail-design.md
 * (Section 4 — Admin 操作 card).
 *
 * All four actions proxy to the admin-customers Express router
 * (apps/api/src/routes/admin-customers.ts) using the caller's Supabase
 * session JWT, then revalidate the detail page so the client re-fetches
 * profile / balance / ledger after each mutation.
 */

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"

async function getToken(): Promise<string | undefined> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token
}

export async function adjustPointsAction(
  customerId: string,
  delta: number,
  note: string,
): Promise<{ ok: boolean }> {
  const token = await getToken()
  const data = await apiClient<{ ok: boolean }>(
    `/admin/customers/${customerId}/points/adjust`,
    {
      method: "POST",
      body: JSON.stringify({ delta, note }),
      token,
    },
  )
  revalidatePath(`/admin/customers/${customerId}`)
  return data
}

export async function changeTierAction(
  customerId: string,
  tierId: string,
): Promise<{ ok: boolean }> {
  const token = await getToken()
  const data = await apiClient<{ ok: boolean }>(
    `/admin/customers/${customerId}/tier`,
    {
      method: "PATCH",
      body: JSON.stringify({ tier_id: tierId }),
      token,
    },
  )
  revalidatePath(`/admin/customers/${customerId}`)
  return data
}

export async function sendResetEmailAction(
  customerId: string,
): Promise<{ ok: boolean; message?: string }> {
  const token = await getToken()
  const data = await apiClient<{ ok: boolean; message?: string }>(
    `/admin/customers/${customerId}/send-reset-email`,
    {
      method: "POST",
      body: JSON.stringify({}),
      token,
    },
  )
  // No revalidate — this action doesn't mutate any page-rendered data.
  return data
}

export async function disableAccountAction(
  customerId: string,
  disabled: boolean,
): Promise<{ ok: boolean; role?: string }> {
  const token = await getToken()
  const data = await apiClient<{ ok: boolean; role?: string }>(
    `/admin/customers/${customerId}/disabled`,
    {
      method: "PATCH",
      body: JSON.stringify({ disabled }),
      token,
    },
  )
  revalidatePath(`/admin/customers/${customerId}`)
  return data
}
