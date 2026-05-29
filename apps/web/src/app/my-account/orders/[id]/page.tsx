import Link from "next/link"
import { notFound } from "next/navigation"
import { redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"

export const metadata = { title: "訂單詳情 | 誠真生活 RealReal" }

type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled"

type OrderItem = {
  id: string
  qty: number
  unit_price: number
  product_snapshot?: { name?: string; variant_name?: string } | null
}

type OrderDetail = {
  id: string
  order_number: string
  created_at: string
  status: OrderStatus
  total: number
  payment_method: string
  payment_status: string
  shipping_method: string
  shipping_status: string
  address: {
    name: string
    phone: string
    city: string
    postal_code: string
    address_type: string
  }
  items: OrderItem[]
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待付款",
  paid: "已付款",
  shipped: "出貨中",
  delivered: "已送達",
  cancelled: "已取消",
}

const STATUS_VARIANTS: Record<OrderStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  paid: "default",
  shipped: "secondary",
  delivered: "default",
  cancelled: "destructive",
}

const TIMELINE_STEPS = [
  { key: "pending", label: "訂單成立" },
  { key: "paid", label: "付款完成" },
  { key: "shipped", label: "出貨中" },
  { key: "delivered", label: "已送達" },
] as const

const TIMELINE_ORDER: OrderStatus[] = ["pending", "paid", "shipped", "delivered"]

function isOrderStatus(s: string): s is OrderStatus {
  return ["pending", "paid", "shipped", "delivered", "cancelled"].includes(s)
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")
  const { data: { session } } = await supabase.auth.getSession()

  let order: OrderDetail | null = null
  try {
    const res = await apiClient<{ data: OrderDetail }>(`/orders/${id}`, { token: session?.access_token ?? "" })
    order = res.data ?? null
  } catch {
    order = null
  }

  if (!order) notFound()

  const status = isOrderStatus(order.status) ? order.status : "pending"
  const currentStepIndex = TIMELINE_ORDER.indexOf(status)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/my-account/orders"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[#10305a] hover:underline"
      >
        <ChevronLeft className="h-4 w-4" />
        回訂單列表
      </Link>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#10305a]">訂單詳情</h1>
        <p className="text-[#687279] font-mono mt-1">{order.order_number}</p>
      </div>

      {/* Timeline */}
      {status !== "cancelled" && (
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {TIMELINE_STEPS.map((step, index) => {
              const isCompleted = index <= currentStepIndex
              const isCurrent = index === currentStepIndex
              return (
                <div key={step.key} className="flex flex-col items-center flex-1">
                  <div
                    className={[
                      "h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium border-2",
                      isCompleted
                        ? "bg-[#10305a] border-[#10305a] text-white"
                        : "border-zinc-300 text-zinc-400",
                    ].join(" ")}
                  >
                    {isCompleted ? "✓" : index + 1}
                  </div>
                  <p className={["text-xs mt-1 text-center", isCurrent ? "font-semibold" : "text-zinc-500"].join(" ")}>
                    {step.label}
                  </p>
                  {index < TIMELINE_STEPS.length - 1 && (
                    <div className="absolute" />
                  )}
                </div>
              )
            })}
          </div>
          {/* Connector line */}
          <div className="relative -mt-10 mb-4 mx-4 h-0.5 bg-zinc-200">
            <div
              className="h-full bg-[#10305a] transition-all"
              style={{ width: `${(currentStepIndex / (TIMELINE_STEPS.length - 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Status Badge */}
      <div className="mb-6 flex items-center gap-3">
        <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
        <span className="text-sm text-zinc-500">
          {new Date(order.created_at).toLocaleDateString("zh-TW", {
            year: "numeric", month: "long", day: "numeric",
          })}
        </span>
      </div>

      {/* Items Table */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3 text-[#10305a]">訂購商品</h2>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="text-left p-3 font-medium">商品</th>
                <th className="text-center p-3 font-medium">數量</th>
                <th className="text-right p-3 font-medium">小計</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {order.items.map(item => (
                <tr key={item.id}>
                  <td className="p-3">
                    <p className="font-medium">{item.product_snapshot?.name ?? "商品"}</p>
                    <p className="text-zinc-500">{item.product_snapshot?.variant_name ?? ""}</p>
                  </td>
                  <td className="p-3 text-center">{item.qty}</td>
                  <td className="p-3 text-right">
                    NT$ {(item.unit_price * item.qty).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-50">
              <tr>
                <td colSpan={2} className="p-3 font-semibold text-right">總計</td>
                <td className="p-3 font-semibold text-right">
                  NT$ {Number(order.total).toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Address & Payment */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div>
          <h2 className="text-lg font-semibold mb-3 text-[#10305a]">收件資訊</h2>
          <div className="p-4 bg-zinc-50 rounded-lg space-y-1 text-sm">
            <p><span className="text-zinc-500">姓名：</span>{order.address.name}</p>
            <p><span className="text-zinc-500">電話：</span>{order.address.phone}</p>
            <p><span className="text-zinc-500">縣市：</span>{order.address.city}</p>
            <p><span className="text-zinc-500">郵遞區號：</span>{order.address.postal_code}</p>
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold mb-3 text-[#10305a]">付款 / 配送</h2>
          <div className="p-4 bg-zinc-50 rounded-lg space-y-1 text-sm">
            <p><span className="text-zinc-500">付款方式：</span>{order.payment_method}</p>
            <p>
              <span className="text-zinc-500">付款狀態：</span>
              <Badge variant={order.payment_status === "paid" ? "default" : "outline"} className="ml-1 text-xs">
                {order.payment_status === "paid" ? "已付款" : "待付款"}
              </Badge>
            </p>
            <p><span className="text-zinc-500">配送方式：</span>{order.shipping_method}</p>
            <p>
              <span className="text-zinc-500">配送狀態：</span>
              <Badge variant={order.shipping_status === "delivered" ? "default" : "secondary"} className="ml-1 text-xs">
                {order.shipping_status === "delivered" ? "已送達" : order.shipping_status === "shipped" ? "出貨中" : "備貨中"}
              </Badge>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
