import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { AdminTabs } from "../_components/AdminTabs"
import {
  getOrderDisplayStatus,
  type DisplayStatus,
} from "@/lib/order-display-status"

const ORDER_TABS = [
  { href: "/admin/orders", label: "訂單" },
  { href: "/admin/subscriptions", label: "訂閱" },
]

export const metadata = { title: "訂單管理 | Admin" }

const STATUS_TABS = [
  { label: "全部", value: "" },
  { label: "待付款", value: "pending" },
  { label: "處理中", value: "processing" },
  { label: "已出貨", value: "shipped" },
  { label: "已完成", value: "completed" },
  { label: "已取消", value: "cancelled" },
]

const DISPLAY_BADGE_CLASSES: Record<DisplayStatus["color"], string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; payment?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from("orders")
    .select(
      "id, order_number, status, payment_status, payment_method, total, created_at, user_id, guest_email, logistics(status, type)"
    )
    .order("created_at", { ascending: false })
    .limit(200)

  if (params.status) query = query.eq("status", params.status)
  if (params.payment) query = query.eq("payment_status", params.payment)
  if (params.from) query = query.gte("created_at", params.from)
  if (params.to) query = query.lte("created_at", params.to)

  const { data: orders } = await query

  // orders has no FK to user_profiles, so resolve display names in a second query
  const userIds = [
    ...new Set((orders ?? []).map((o) => o.user_id).filter(Boolean) as string[]),
  ]
  const nameByUser = new Map<string, string | null>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", userIds)
    for (const p of profiles ?? []) nameByUser.set(p.user_id, p.display_name)
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-2 text-[#10305a]">訂單</h1>
      <AdminTabs tabs={ORDER_TABS} />

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map((tab) => {
          const isActive = (params.status ?? "") === tab.value
          const href = tab.value ? `/admin/orders?status=${tab.value}` : "/admin/orders"
          return (
            <Link
              key={tab.value}
              href={href}
              className={`px-3 py-1.5 rounded-[10px] text-sm border transition-colors ${
                isActive
                  ? "bg-[#10305a] text-white border-[#10305a]"
                  : "bg-white text-[#687279] border-[#10305a]/20 hover:bg-[#10305a]/5"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-[#687279] text-xs uppercase">
            <tr>
              <th className="px-4 py-3 text-left">訂單號</th>
              <th className="px-4 py-3 text-left">顧客</th>
              <th className="px-4 py-3 text-left">狀態</th>
              <th className="px-4 py-3 text-right">金額</th>
              <th className="px-4 py-3 text-left">時間</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {!orders || orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  暫無訂單
                </td>
              </tr>
            ) : (
              orders.map((order) => {
                const displayName = order.user_id ? nameByUser.get(order.user_id) : null
                const display = getOrderDisplayStatus(
                  order,
                  order.logistics?.[0] ?? null,
                )
                return (
                  <tr key={order.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono text-xs">{order.order_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-xs">{displayName ?? "訪客"}</p>
                      <p className="text-zinc-400 text-xs">{order.guest_email ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={DISPLAY_BADGE_CLASSES[display.color]}>
                        {display.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      NT$ {Number(order.total).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(order.created_at).toLocaleDateString("zh-TW")}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="text-[#10305a] hover:underline text-xs font-medium"
                      >
                        查看
                      </Link>
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
