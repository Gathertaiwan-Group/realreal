import Link from "next/link"
import { redirect } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ORDER_STATUS_LABELS as STATUS_LABELS,
  ORDER_STATUS_VARIANTS as STATUS_VARIANTS,
  isOrderStatus,
  type OrderStatus,
} from "@/lib/order-status"

export const metadata = { title: "我的訂單 | 誠真生活 RealReal" }

type Order = {
  id: string
  order_number: string
  created_at: string
  status: OrderStatus
  total: number
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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/my-account"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[#10305a] hover:underline"
      >
        <ChevronLeft className="h-4 w-4" />
        回帳戶概覽
      </Link>
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
