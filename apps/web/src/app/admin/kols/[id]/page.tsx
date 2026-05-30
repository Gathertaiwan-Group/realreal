import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { KolDetailClient, type KolDetailData } from "./_client"

/**
 * KOL detail page (admin only).
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
 * (Section 6 — admin UI detail).
 *
 * Server fetches the fat payload from the Express API
 * (`GET /admin/kols/:id`) which includes the KOL row, any linked coupon,
 * stats, and up to ~50 recent attributed orders. Passes everything to the
 * client component which renders the 4-card layout: edit form, stats,
 * copy links, recent orders.
 */

export const metadata = { title: "KOL 詳情 | Admin" }
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

interface DetailResponse {
  data?: KolDetailData
  kol?: KolDetailData
}

export default async function AdminKolDetailPage({ params }: PageProps) {
  const { id } = await params

  const API_URL =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.RAILWAY_API_URL ??
    "http://localhost:4000"

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? ""

  let detail: KolDetailData | null = null
  let loadError: string | null = null

  try {
    const res = await fetch(`${API_URL}/admin/kols/${id}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    })
    if (res.status === 404) notFound()
    if (res.ok) {
      const json: DetailResponse = await res.json()
      detail = json.data ?? json.kol ?? null
    } else {
      loadError = `API ${res.status}`
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err)
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <Link
          href="/admin/kols"
          className="text-sm text-zinc-400 hover:text-zinc-600"
        >
          ← 聯盟行銷
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          載入 KOL 失敗：{loadError ?? "未知錯誤"}
        </div>
      </div>
    )
  }

  return <KolDetailClient kolId={id} initialData={detail} />
}
