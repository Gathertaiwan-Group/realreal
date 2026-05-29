import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const metadata = { title: "我的訂單 | 誠真生活 RealReal" }

type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled"

type Order = {
  id: string
  order_number: string
  created_at: string
  status: OrderStatus
  total: number
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

function isOrderStatus(s: string): s is OrderStatus {
  return ["pending", "paid", "shipped", "delivered", "cancelled"].includes(s)
}

export default async function OrdersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")
  const { data: { session } } = await supabase.auth.getSession()

  let orders: Order[] = []
  try {
    const res = await apiClient<{ data: Order[] }>("/orders", { token: session?.access_token ?? "" })
    orders = res.data ?? []
  } catch {
    orders = []
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 text-[#10305a]">我的訂單</h1>

      {orders.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-500 mb-4">尚無訂單記錄</p>
          <Link href="/"><Button>開始購物</Button></Link>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {orders.map(order => {
            const status = isOrderStatus(order.status) ? order.status : "pending"
            return (
              <div key={order.id} className="flex items-center justify-between p-4">
                <div className="space-y-1">
                  <p className="font-medium font-mono">{order.order_number}</p>
                  <p className="text-sm text-zinc-500">
                    {new Date(order.created_at).toLocaleDateString("zh-TW")}
                  </p>
                  <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
                </div>
                <div className="text-right space-y-2">
                  <p className="font-semibold">NT$ {Number(order.total).toLocaleString()}</p>
                  <Link href={`/my-account/orders/${order.id}`}>
                    <Button variant="outline" size="sm">查看詳情</Button>
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
