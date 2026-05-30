import { notFound } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"
import { CustomerDetailClient, type CustomerDetailData } from "./_client"

/**
 * Customer detail page (admin only).
 *
 * Spec: docs/superpowers/specs/2026-05-30-points-tiers-customer-detail-design.md
 * (Section 4). Server fetches the fat payload from the Express API
 * (`GET /admin/customers/:id` — created in task B2) plus the list of
 * tiers (for the "更換等級" dropdown), and hands both to the client
 * component which renders the 5-card layout.
 */

export const metadata = { title: "客戶詳情 | Admin" }
export const dynamic = "force-dynamic"

interface PageProps {
  params: Promise<{ id: string }>
}

interface DetailResponse {
  data: CustomerDetailData
}

interface TierRow {
  id: string
  name: string
  min_spend: number | string
  rebate_rate: number | string
  sort_order: number
}

export default async function AdminCustomerDetailPage({ params }: PageProps) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token

  // 1. Fat detail payload from the API (cf. apps/api/src/routes/admin-customers.ts)
  let detail: CustomerDetailData
  try {
    const res = await apiClient<DetailResponse>(`/admin/customers/${id}`, {
      method: "GET",
      token,
      cache: "no-store",
    })
    detail = res.data
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 404 from the API → render Next.js not-found.
    if (msg.includes("not found") || msg.includes("404")) {
      notFound()
    }
    return (
      <div className="space-y-3">
        <Link
          href="/admin/customers"
          className="text-sm text-zinc-400 hover:text-zinc-600"
        >
          ← 客戶列表
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          載入客戶詳情失敗：{msg}
        </div>
      </div>
    )
  }

  // 2. Tier list for the "更換等級" dropdown (Admin 操作 card).
  // Read directly via Supabase — cheaper than another API hop, and the
  // tier table is admin-readable.
  const { data: tierRows } = await supabase
    .from("membership_tiers")
    .select("id, name, min_spend, rebate_rate, sort_order")
    .order("sort_order", { ascending: true })

  const tiers: TierRow[] = (tierRows ?? []) as TierRow[]

  return <CustomerDetailClient customerId={id} data={detail} tiers={tiers} />
}
