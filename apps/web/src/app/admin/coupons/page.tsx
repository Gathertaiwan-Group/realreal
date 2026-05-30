import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"
import { CreateCouponForm } from "./_client"
import { AdminTabs } from "../_components/AdminTabs"

const MARKETING_TABS = [
  { href: "/admin/campaigns", label: "行銷活動" },
  { href: "/admin/coupons", label: "優惠券" },
  { href: "/admin/marketing/tiers", label: "會員等級" },
  { href: "/admin/marketing/points", label: "點數規則" },
]

export const metadata = { title: "優惠券管理 | Admin" }

interface CouponRow {
  id: string
  code: string
  type: string
  value: number
  used_count: number
  max_uses: number | null
  expires_at: string | null
  applicable_to: string | null
  is_active: boolean
  tier_id: string | null
  tier?: { name: string } | null
}

interface CouponsResponse {
  data?: CouponRow[]
  coupons?: CouponRow[]
}

const TYPE_LABEL: Record<string, string> = {
  percentage: "百分比",
  fixed: "固定金額",
  free_shipping: "免運費",
}

function couponStatus(coupon: CouponRow): {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
} {
  if (!coupon.is_active) return { label: "停用", variant: "secondary" }
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses)
    return { label: "已用完", variant: "destructive" }
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
    return { label: "已過期", variant: "destructive" }
  return { label: "啟用中", variant: "default" }
}

function formatValue(coupon: CouponRow): string {
  if (coupon.type === "percentage") return `${coupon.value}%`
  if (coupon.type === "free_shipping") return "免運"
  return `NT$ ${coupon.value.toLocaleString()}`
}

export default async function AdminCouponsPage() {
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.RAILWAY_API_URL ?? "http://localhost:4000"
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ""

  let coupons: CouponRow[] = []

  try {
    const res = await fetch(`${API_URL}/admin/coupons`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      next: { revalidate: 30 },
    })
    if (res.ok) {
      const data: CouponsResponse = await res.json()
      coupons = data.data ?? data.coupons ?? []
    }
  } catch {
    // API unavailable — show empty state
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-xl font-semibold text-[#10305a]">行銷</h1>
        <AdminTabs tabs={MARKETING_TABS} />
      </div>

      {/* Inline create form */}
      <CreateCouponForm />

      {/* Stats summary */}
      {coupons.length > 0 && (
        <div className="flex gap-4 text-sm text-zinc-500">
          <span>共 {coupons.length} 張</span>
          <span>啟用中 {coupons.filter((c) => couponStatus(c).label === "啟用中").length} 張</span>
          <span>已過期/用完 {coupons.filter((c) => ["已過期", "已用完"].includes(couponStatus(c).label)).length} 張</span>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">代碼</th>
              <th className="px-4 py-3 text-left">類型</th>
              <th className="px-4 py-3 text-left">限定等級</th>
              <th className="px-4 py-3 text-right">折扣值</th>
              <th className="px-4 py-3 text-right">已使用 / 上限</th>
              <th className="px-4 py-3 text-left">到期日</th>
              <th className="px-4 py-3 text-center">狀態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {coupons.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-zinc-400">
                  暫無優惠券資料，點擊上方按鈕新增
                </td>
              </tr>
            ) : (
              coupons.map((coupon) => {
                const status = couponStatus(coupon)
                return (
                  <tr key={coupon.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <code className="bg-zinc-100 px-1.5 py-0.5 rounded text-xs font-bold">
                        {coupon.code}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      {TYPE_LABEL[coupon.type] ?? coupon.type}
                    </td>
                    <td className="px-4 py-3 text-zinc-600 text-xs">
                      {coupon.tier?.name ? (
                        <Badge variant="outline">{coupon.tier.name}</Badge>
                      ) : (
                        <span className="text-zinc-400">全部</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      {formatValue(coupon)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="font-medium">{coupon.used_count}</span>
                      <span className="text-zinc-400">
                        {" / "}
                        {coupon.max_uses != null ? coupon.max_uses : "∞"}
                      </span>
                      {coupon.max_uses != null && coupon.max_uses > 0 && (
                        <div className="mt-1 h-1 w-16 ml-auto bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-zinc-900 rounded-full"
                            style={{
                              width: `${Math.min(100, (coupon.used_count / coupon.max_uses) * 100)}%`,
                            }}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {coupon.expires_at
                        ? new Date(coupon.expires_at).toLocaleDateString("zh-TW")
                        : "無限期"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
