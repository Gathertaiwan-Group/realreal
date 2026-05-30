import { createClient } from "@/lib/supabase/server"
import { KolsListClient, type KolListRow } from "./_client"

/**
 * KOL / 聯盟行銷 list page.
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
 * (Section 6 — admin UI list).
 *
 * Server-side fetches `GET /admin/kols` (admin JWT) which returns each KOL
 * row joined with stats: order_count, total_revenue, est_commission.
 * Hands the list off to the client component which renders the table,
 * inline "新增 KOL" form, and per-row navigate-to-detail behaviour.
 */

export const metadata = { title: "聯盟行銷 / KOL | Admin" }
export const dynamic = "force-dynamic"

interface KolsResponse {
  data?: KolListRow[]
  kols?: KolListRow[]
}

export default async function AdminKolsPage() {
  const API_URL =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.RAILWAY_API_URL ??
    "http://localhost:4000"

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? ""

  let kols: KolListRow[] = []
  let loadError: string | null = null

  try {
    const res = await fetch(`${API_URL}/admin/kols`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    })
    if (res.ok) {
      const data: KolsResponse = await res.json()
      kols = data.data ?? data.kols ?? []
    } else {
      loadError = `API ${res.status}`
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err)
  }

  return <KolsListClient kols={kols} loadError={loadError} />
}
