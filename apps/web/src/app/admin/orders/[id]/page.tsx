import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { OrderActions, OrderTimeline } from "./_client"

export const metadata = { title: "訂單詳情 | Admin" }

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  processing: "secondary",
  shipped: "default",
  completed: "default",
  cancelled: "destructive",
  failed: "destructive",
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待付款",
  processing: "處理中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失敗",
}

const PAYMENT_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  paid: "default",
  failed: "destructive",
  refunded: "secondary",
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: "待付款",
  paid: "已付款",
  failed: "付款失敗",
  refunded: "已退款",
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(
      `
      *,
      order_items(*),
      order_addresses(*),
      payments(*),
      invoices!invoices_order_id_fkey(*)
    `
    )
    .eq("id", id)
    .single()

  if (orderErr) console.error("[admin/orders/[id]] query error:", orderErr)
  if (!order) notFound()

  // user_profiles has no FK to orders, so resolve separately. Email lives in
  // auth.users which is not reachable via PostgREST from the browser; fall
  // back to guest_email.
  let profile: { display_name: string | null; email: string | null; phone: string | null } | null = null
  if (order.user_id) {
    const { data: p } = await supabase
      .from("user_profiles")
      .select("display_name, phone")
      .eq("user_id", order.user_id)
      .maybeSingle()
    if (p) profile = { display_name: p.display_name, email: order.guest_email ?? null, phone: p.phone }
  } else if (order.guest_email) {
    profile = { display_name: null, email: order.guest_email, phone: null }
  }
  const shippingAddr = order.order_addresses?.find((a: Record<string, unknown>) => a.type === "shipping")
  const billingAddr = order.order_addresses?.find((a: Record<string, unknown>) => a.type === "billing")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/admin/orders" className="text-zinc-400 hover:text-zinc-600 text-sm">
              ← 訂單列表
            </Link>
          </div>
          <h1 className="text-xl font-semibold">訂單 #{order.order_number}</h1>
          <p className="text-zinc-500 text-sm">
            建立於 {new Date(order.created_at).toLocaleString("zh-TW")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={STATUS_VARIANT[order.status] ?? "outline"}>
            {STATUS_LABEL[order.status] ?? order.status}
          </Badge>
          <Badge variant={PAYMENT_STATUS_VARIANT[order.payment_status] ?? "outline"}>
            {PAYMENT_STATUS_LABEL[order.payment_status] ?? order.payment_status}
          </Badge>
        </div>
      </div>

      {/* Action Buttons */}
      <OrderActions orderId={id} status={order.status} paymentStatus={order.payment_status} />

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">訂單進度</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderTimeline status={order.status} createdAt={order.created_at} />
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">訂單商品</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-xs">
              <tr>
                <th className="px-4 py-2.5 text-left">商品名稱</th>
                <th className="px-4 py-2.5 text-left">規格</th>
                <th className="px-4 py-2.5 text-right">單價</th>
                <th className="px-4 py-2.5 text-right">數量</th>
                <th className="px-4 py-2.5 text-right">小計</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {order.order_items?.map((item: Record<string, unknown>) => {
                const snapshot = item.product_snapshot as Record<string, unknown> | null
                const unitPrice = Number(item.unit_price)
                const qty = Number(item.qty)
                return (
                  <tr key={item.id as string}>
                    <td className="px-4 py-3">{(snapshot?.name as string) ?? "—"}</td>
                    <td className="px-4 py-3 text-zinc-500">
                      {(snapshot?.variant_label as string) ?? (item.variant_id ? String(item.variant_id) : "—")}
                    </td>
                    <td className="px-4 py-3 text-right">NT$ {unitPrice.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">{qty}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      NT$ {(unitPrice * qty).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t bg-zinc-50">
              {order.discount_amount != null && Number(order.discount_amount) > 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-zinc-500">折扣</td>
                  <td className="px-4 py-2 text-right text-red-600">
                    -NT$ {Number(order.discount_amount).toLocaleString()}
                  </td>
                </tr>
              )}
              {order.shipping_fee != null && Number(order.shipping_fee) > 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-zinc-500">運費</td>
                  <td className="px-4 py-2 text-right">
                    NT$ {Number(order.shipping_fee).toLocaleString()}
                  </td>
                </tr>
              )}
              <tr>
                <td colSpan={4} className="px-4 py-2.5 text-right font-semibold">訂單總計</td>
                <td className="px-4 py-2.5 text-right font-semibold text-base">
                  NT$ {Number(order.total).toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Customer Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">顧客資訊</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-zinc-500">姓名</span>
              <span>{profile?.display_name ?? "訪客"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Email</span>
              <span>{profile?.email ?? "—"}</span>
            </div>
            {profile?.phone && (
              <div className="flex justify-between">
                <span className="text-zinc-500">電話</span>
                <span>{profile.phone}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Shipping Address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">收件資訊</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {shippingAddr ? (
              <>
                <div className="flex justify-between">
                  <span className="text-zinc-500">收件人</span>
                  <span>{shippingAddr.name as string}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">電話</span>
                  <span>{shippingAddr.phone as string}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">地址</span>
                  <span className="text-right max-w-[60%]">
                    {(shippingAddr.address as string) ||
                      `${shippingAddr.cvs_type as string} ${shippingAddr.cvs_store_id as string}`}
                  </span>
                </div>
                {shippingAddr.note && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">備註</span>
                    <span className="text-right max-w-[60%]">{shippingAddr.note as string}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-zinc-400">無收件資訊</p>
            )}
          </CardContent>
        </Card>

        {/* Payment Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">付款資訊</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-zinc-500">付款方式</span>
              <span>{order.payment_method ?? "—"}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-zinc-500">付款狀態</span>
              <Badge variant={PAYMENT_STATUS_VARIANT[order.payment_status] ?? "outline"}>
                {PAYMENT_STATUS_LABEL[order.payment_status] ?? order.payment_status}
              </Badge>
            </div>
            {order.payments?.[0]?.gateway_tx_id && (
              <div className="flex justify-between">
                <span className="text-zinc-500">交易 ID</span>
                <span className="font-mono text-xs">{order.payments[0].gateway_tx_id}</span>
              </div>
            )}
            {order.payments?.[0]?.paid_at && (
              <div className="flex justify-between">
                <span className="text-zinc-500">付款時間</span>
                <span>{new Date(order.payments[0].paid_at).toLocaleString("zh-TW")}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logistics Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">物流資訊</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {order.logistics?.[0] ? (
              <>
                <div className="flex justify-between">
                  <span className="text-zinc-500">物流商</span>
                  <span>{order.logistics[0].provider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">追蹤號</span>
                  <span className="font-mono text-xs">{order.logistics[0].tracking_number ?? "—"}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500">物流狀態</span>
                  <Badge variant="outline">{order.logistics[0].status}</Badge>
                </div>
                {order.logistics[0].shipped_at && (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">出貨時間</span>
                    <span>{new Date(order.logistics[0].shipped_at).toLocaleString("zh-TW")}</span>
                  </div>
                )}
              </>
            ) : (
              <p className="text-zinc-400">尚未建立物流</p>
            )}
          </CardContent>
        </Card>

        {/* Invoice Info */}
        {order.invoices?.[0] && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">發票資訊</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-500">發票號碼</span>
                <span className="font-mono">{order.invoices[0].invoice_number ?? "—"}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">狀態</span>
                <Badge variant="outline">{order.invoices[0].status}</Badge>
              </div>
              {order.invoices[0].issued_at && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">開立時間</span>
                  <span>{new Date(order.invoices[0].issued_at).toLocaleString("zh-TW")}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Billing Address (if different) */}
        {billingAddr && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">帳單地址</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-zinc-500">姓名</span>
                <span>{billingAddr.name as string}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">地址</span>
                <span className="text-right max-w-[60%]">{billingAddr.address as string}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
