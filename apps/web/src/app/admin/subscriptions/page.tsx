import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { AdminTabs } from "../_components/AdminTabs"

const ORDER_TABS = [
  { href: "/admin/orders", label: "訂單" },
  { href: "/admin/subscriptions", label: "訂閱" },
]

export const metadata = { title: "訂閱管理 | Admin" }

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  cancelled: "secondary",
  past_due: "destructive",
  paused: "outline",
}

const STATUS_TABS = [
  { label: "全部", value: "" },
  { label: "活躍", value: "active" },
  { label: "逾期", value: "past_due" },
  { label: "暫停", value: "paused" },
  { label: "已取消", value: "cancelled" },
]

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from("subscriptions")
    .select(
      `
      id, user_id, status, next_billing_date, retry_count, created_at,
      subscription_plans(name, price)
    `
    )
    .order("created_at", { ascending: false })
    .limit(500)

  if (params.status) query = query.eq("status", params.status)

  const { data: subscriptions } = await query

  // Fetch user profiles for display names (no direct FK from subscriptions to user_profiles)
  const userIds = [...new Set((subscriptions ?? []).map((s) => s.user_id))]
  const profileMap = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds)
    for (const p of profiles ?? []) {
      profileMap.set(p.user_id, p.display_name ?? "—")
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-2 text-[#10305a]">訂閱</h1>
      <AdminTabs tabs={ORDER_TABS} />

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map((tab) => {
          const isActive = (params.status ?? "") === tab.value
          const href = tab.value
            ? `/admin/subscriptions?status=${tab.value}`
            : "/admin/subscriptions"
          return (
            <Link
              key={tab.value}
              href={href}
              className={`px-3 py-1.5 rounded-[10px] text-sm border transition-colors ${
                isActive
                  ? "bg-[#10305a] text-white border-[#10305a]"
                  : "bg-white text-[#687279] border-[#10305a]/10 hover:bg-[#fffeee]/50"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="border border-[#10305a]/10 rounded-[10px] overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-[#10305a] text-xs">
            <tr>
              <th className="px-4 py-3 text-left font-medium">會員</th>
              <th className="px-4 py-3 text-left font-medium">方案</th>
              <th className="px-4 py-3 text-left font-medium">狀態</th>
              <th className="px-4 py-3 text-left font-medium">下次扣款</th>
              <th className="px-4 py-3 text-left font-medium">重試次數</th>
              <th className="px-4 py-3 text-left font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!subscriptions || subscriptions.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[#687279]">
                  暫無訂閱資料
                </td>
              </tr>
            ) : (
              subscriptions.map((sub) => (
                <tr key={sub.id} className="hover:bg-[#fffeee]/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#10305a]">
                      {profileMap.get(sub.user_id) ?? "—"}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[#10305a]">
                    {(sub.subscription_plans as unknown as { name: string; price: number } | null)?.name ??
                      "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[sub.status] ?? "outline"}>{sub.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[#687279]">
                    {sub.next_billing_date
                      ? new Date(sub.next_billing_date).toLocaleDateString("zh-TW")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {sub.retry_count > 0 ? (
                      <Badge variant="destructive">{sub.retry_count}</Badge>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-400">
                    —
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
