"use server"

/**
 * Server actions for /admin/kols.
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
 * (Sections 2 & 6 — admin CRUD).
 *
 * All three actions proxy to the admin-kols Express router
 * (apps/api/src/routes/admin-kols.ts) using the caller's Supabase session
 * JWT, then revalidate the list / detail paths so the UI re-fetches after
 * each mutation.
 */

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"

export interface KolUpsertInput {
  slug: string
  name: string
  bio: string | null
  avatar_url: string | null
  instagram_handle: string | null
  youtube_handle: string | null
  tiktok_handle: string | null
  coupon_id: string | null
  commission_rate: number
  is_active: boolean
  notes?: string | null
}

export interface KolUpdateInput {
  slug?: string
  name?: string
  bio?: string | null
  avatar_url?: string | null
  instagram_handle?: string | null
  youtube_handle?: string | null
  tiktok_handle?: string | null
  coupon_id?: string | null
  commission_rate?: number
  is_active?: boolean
  notes?: string | null
}

interface KolEnvelope {
  data?: KolRecord
  kol?: KolRecord
}

interface KolRecord {
  id: string
  slug: string
  name: string
  is_active: boolean
}

async function getToken(): Promise<string | undefined> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token
}

export async function createKolAction(
  input: KolUpsertInput,
): Promise<KolRecord | null> {
  const token = await getToken()
  const res = await apiClient<KolEnvelope>("/admin/kols", {
    method: "POST",
    body: JSON.stringify(input),
    token,
  })
  revalidatePath("/admin/kols")
  return res.data ?? res.kol ?? null
}

export async function updateKolAction(
  id: string,
  input: KolUpdateInput,
): Promise<KolRecord | null> {
  const token = await getToken()
  const res = await apiClient<KolEnvelope>(`/admin/kols/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
    token,
  })
  revalidatePath("/admin/kols")
  revalidatePath(`/admin/kols/${id}`)
  return res.data ?? res.kol ?? null
}

export async function deleteKolAction(
  id: string,
): Promise<{ ok: boolean }> {
  const token = await getToken()
  const res = await apiClient<{ ok?: boolean }>(`/admin/kols/${id}`, {
    method: "DELETE",
    token,
  })
  revalidatePath("/admin/kols")
  return { ok: res.ok ?? true }
}
