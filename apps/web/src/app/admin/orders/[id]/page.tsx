import { createClient } from "@/lib/supabase/server"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { buildDiscountBreakdown } from "@/lib/discount-breakdown"
import { InvoiceCard, LogisticsCard, OrderActions, OrderTimeline } from "./_client"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

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
  // 訂單狀態的 pending 是「尚未處理」，與付款狀態的「待付款」badge 並排顯示，
  // 兩個都叫待付款會看起來像重複 — 訂單側用「待處理」。
  pending: "待處理",
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
      // orders / order_items / order_addresses / invoices stay `*`: small rows,
      // no heavy JSONB, and some columns (e.g. order_addresses.note) live only
      // in the dashboard schema — listing them explicitly risks an undefined
      // field or a PostgREST "column does not exist" that 500s the whole page.
      // payments + logistics are pruned to the columns the UI actually reads so
      // we stop hauling their large unused `raw_response` JSONB blobs.
      `
      *,
      order_items(*),
      order_addresses(*),
      payments(id, gateway_tx_id, paid_at),
      invoices!invoices_order_id_fkey(*),
      logistics(id, provider, type, ecpay_logistics_id, tracking_number, cvs_payment_no, cvs_validation_no, status, shipped_at, delivered_at)
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

  // Resolve campaign names so the discount breakdown can say WHICH campaign
  // (applied_campaign_ids is stored on the order at creation time).
  let campaignNames: string[] = []
  const campaignIds = (order.applied_campaign_ids ?? []) as string[]
  if (campaignIds.length > 0) {
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("id, name")
      .in("id", campaignIds)
    campaignNames = (campaigns ?? []).map((c: { name: string | null }) => c.name ?? "").filter(Boolean)
  }
  const discountLines = buildDiscountBreakdown({
    discount_amount: order.discount_amount,
    campaign_discount: order.campaign_discount,
    points_used: order.points_used,
    metadata: order.metadata ?? null,
    campaignNames,
    attributed_kol_slug: order.attributed_kol_slug ?? null,
  })
  const freeItems = (order.free_items ?? []) as Array<{ name?: string; sku?: string; qty?: number }>

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
      <OrderActions
        orderId={id}
        status={order.status}
        paymentStatus={order.payment_status}
        logistics={order.logistics?.[0] ?? null}
      />

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">訂單進度</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderTimeline
            status={order.status}
            createdAt={order.created_at}
            logistics={order.logistics?.[0] ?? null}
          />
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
                      {/* snapshot writer (orders.ts) stores variant_name; variant_label kept for older rows */}
                      {(snapshot?.variant_name as string) ?? (snapshot?.variant_label as string) ?? "—"}
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
              <tr>
                <td colSpan={4} className="px-4 py-2 text-right text-zinc-500">商品小計</td>
                <td className="px-4 py-2 text-right">
                  NT$ {Number(order.subtotal ?? 0).toLocaleString()}
                </td>
              </tr>
              {freeItems.map((g, i) => (
                <tr key={`gift-${i}`}>
                  <td colSpan={4} className="px-4 py-2 text-right text-emerald-700">
                    🎁 滿額贈：{g.name ?? g.sku ?? "贈品"} × {g.qty ?? 1}
                  </td>
                  <td className="px-4 py-2 text-right text-emerald-700">免費</td>
                </tr>
              ))}
              {discountLines.map((d) => (
                <tr key={d.key}>
                  <td colSpan={4} className="px-4 py-2 text-right text-zinc-500">{d.label}</td>
                  <td className="px-4 py-2 text-right text-red-600">
                    -NT$ {d.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="px-4 py-2 text-right text-zinc-500">運費</td>
                <td className="px-4 py-2 text-right">
                  {Number(order.shipping_fee ?? 0) > 0
                    ? `NT$ ${Number(order.shipping_fee).toLocaleString()}`
                    : order.shipping_zeroed_by_campaign
                      ? "免運（行銷活動）"
                      : "NT$ 0"}
                </td>
              </tr>
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

        {/* Logistics Info — rich card with copy buttons + retry */}
        <LogisticsCard
          orderId={id}
          logistics={order.logistics?.[0] ?? null}
          shipping={
            shippingAddr
              ? {
                  name: (shippingAddr.name as string | null) ?? null,
                  phone: (shippingAddr.phone as string | null) ?? null,
                  address: (shippingAddr.address as string | null) ?? null,
                  cvs_store_id: (shippingAddr.cvs_store_id as string | null) ?? null,
                  cvs_type: (shippingAddr.cvs_type as string | null) ?? null,
                  address_type: (shippingAddr.address_type as string | null) ?? null,
                }
              : null
          }
          paymentStatus={order.payment_status}
          shippingMethod={order.shipping_method ?? null}
        />

        {/* Invoice Info — always render; component handles empty state + actions */}
        <InvoiceCard
          orderId={id}
          invoice={order.invoices?.[0] ?? null}
          paymentStatus={order.payment_status}
          apiUrl={API_URL}
        />

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
