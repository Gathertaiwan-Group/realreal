import Link from "next/link"
import { ChevronRight, ShoppingBag } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export interface OrderRow {
  id: string
  order_number: string
  created_at: string
  status: string
  total: number
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待付款",
  processing: "備貨中",
  paid: "已付款",
  shipped: "出貨中",
  delivered: "已送達",
  completed: "已完成",
  cancelled: "已取消",
  failed: "付款失敗",
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  processing: "secondary",
  paid: "default",
  shipped: "default",
  delivered: "default",
  completed: "default",
  cancelled: "destructive",
  failed: "destructive",
}

export function RecentOrdersSection({ orders }: { orders: OrderRow[] }) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#10305a]">近期訂單</h2>
        {orders.length > 0 && (
          <Link
            href="/my-account/orders"
            className="inline-flex items-center gap-1 text-sm text-[#10305a] hover:underline"
          >
            查看全部
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-200 bg-white py-12 text-center">
          <ShoppingBag className="h-10 w-10 text-zinc-300" />
          <p className="text-sm text-zinc-500">還沒有訂單</p>
          <Link
            href="/shop"
            className="text-sm font-medium text-[#10305a] hover:underline"
          >
            去逛逛 →
          </Link>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-[#10305a]/10 bg-white">
          {orders.map((order, i) => (
            <li
              key={order.id}
              className={i > 0 ? "border-t border-zinc-100" : ""}
            >
              <Link
                href={`/my-account/orders/${order.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-zinc-50"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-[#10305a]">
                    {order.order_number}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {new Date(order.created_at).toLocaleDateString("zh-TW")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant={STATUS_VARIANT[order.status] ?? "outline"}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </Badge>
                  <span className="text-sm font-semibold text-[#10305a]">
                    NT$ {Number(order.total).toLocaleString()}
                  </span>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
