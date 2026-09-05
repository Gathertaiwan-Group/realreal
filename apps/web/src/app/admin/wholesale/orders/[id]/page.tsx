"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"
import { API_URL } from "@/lib/api-url"

/**
 * 批發訂單明細 —— 兼出貨單／帳單。
 *
 * 「出貨時附上出貨單／帳單」是這五家的付款流程起點，所以出貨單與帳單就是同一張
 * 紙：上半是揀貨要看的品項與數量，下半是對帳要看的金額與到期日。列印時
 * (@media print) 把後台的外框、按鈕全部隱藏，只留這張單。
 */

type Order = {
  id: string
  order_number: string
  status: string
  status_label: string
  subtotal: number
  shipping_fee: number
  total: number
  notes: string | null
  created_at: string
  wholesale_due_date: string | null
  wholesale_paid_at: string | null
}
type Channel = {
  name: string
  contact_name: string | null
  phone: string | null
  address: string | null
  tax_id: string | null
  payment_terms: "on_receipt_3d" | "month_end"
}
type Item = { id: string; name: string; qty: number; unitPrice: number; amount: number }

const TERMS_LABEL: Record<string, string> = {
  on_receipt_3d: "收貨後 3 個工作天內付款",
  month_end: "月底結帳",
}

export default function WholesaleOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [order, setOrder] = useState<Order | null>(null)
  const [channel, setChannel] = useState<Channel | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await adminFetch(`${API_URL}/admin/wholesale/orders/${id}`)
    const json = await res.json()
    if (!res.ok) {
      toast.error(json.error ?? "讀取失敗")
      return
    }
    setOrder(json.order)
    setChannel(json.channel)
    setItems(json.items ?? [])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/wholesale/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "更新失敗")
        return
      }
      toast.success(okMsg)
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!order || !channel) return <p className="text-sm text-zinc-500">讀取中…</p>

  const totalQty = items.reduce((s, i) => s + i.qty, 0)

  return (
    <div>
      <style>{`
        @media print {
          body { background: #fff; }
          /* 後台外框、側邊選單、按鈕一律不印 */
          nav, aside, header, .no-print { display: none !important; }
          .print-sheet { border: none !important; box-shadow: none !important; padding: 0 !important; }
          main { padding: 0 !important; }
        }
      `}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/wholesale" className="text-xs text-[#10305a] hover:underline">
          ← 通路商
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {order.status === "pending" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ status: "processing" }, "已確認訂單")}
              className="rounded-[10px] border border-[#10305a]/20 px-3 py-1.5 text-sm text-[#10305a] disabled:opacity-50"
            >
              確認訂單
            </button>
          )}
          {(order.status === "pending" || order.status === "processing") && (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ status: "shipped" }, "已標記出貨，付款到期日已產生")}
              className="rounded-[10px] bg-[#10305a] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              標記出貨
            </button>
          )}
          {!order.wholesale_paid_at ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ markPaid: true }, "已標記收款")}
              className="rounded-[10px] border border-green-600/30 px-3 py-1.5 text-sm text-green-700 disabled:opacity-50"
            >
              標記收款
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ markPaid: false }, "已取消收款標記")}
              className="rounded-[10px] border border-zinc-200 px-3 py-1.5 text-sm text-zinc-500 disabled:opacity-50"
            >
              取消收款標記
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-[10px] bg-[#10305a] px-3 py-1.5 text-sm text-white"
          >
            列印出貨單／帳單
          </button>
        </div>
      </div>

      <div className="print-sheet rounded-[10px] border bg-white p-8">
        <div className="mb-6 flex items-start justify-between border-b-2 border-[#10305a] pb-3">
          <div>
            <h1 className="text-xl font-bold text-[#10305a]">誠真生活 RealReal</h1>
            <p className="text-sm text-zinc-500">出貨單／帳單</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-mono font-semibold">{order.order_number}</p>
            <p className="text-zinc-500">
              {new Date(order.created_at).toLocaleDateString("zh-TW")}
            </p>
            <p className="text-zinc-500">{order.status_label}</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="mb-1 text-xs text-zinc-500">通路商</p>
            <p className="font-semibold">{channel.name}</p>
            {channel.contact_name && <p>{channel.contact_name}</p>}
            {channel.phone && <p className="text-zinc-600">{channel.phone}</p>}
            {channel.address && <p className="text-zinc-600">{channel.address}</p>}
            {channel.tax_id && <p className="text-zinc-600">統編 {channel.tax_id}</p>}
          </div>
          <div>
            <p className="mb-1 text-xs text-zinc-500">付款條件</p>
            <p>{TERMS_LABEL[channel.payment_terms]}</p>
            {order.wholesale_due_date && (
              <p className="mt-2">
                <span className="text-xs text-zinc-500">付款到期日　</span>
                <span className="font-semibold text-[#10305a]">{order.wholesale_due_date}</span>
              </p>
            )}
            <p className="mt-2">
              <span className="text-xs text-zinc-500">收款狀態　</span>
              {order.wholesale_paid_at ? (
                <span className="font-semibold text-green-700">
                  已收款（{new Date(order.wholesale_paid_at).toLocaleDateString("zh-TW")}）
                </span>
              ) : (
                <span className="font-semibold text-amber-700">未收款</span>
              )}
            </p>
          </div>
        </div>

        <table className="mb-6 w-full text-sm">
          <thead>
            <tr className="border-y bg-zinc-50 text-xs text-zinc-600">
              <th className="px-2 py-2 text-left">品項</th>
              <th className="px-2 py-2 text-right">單價</th>
              <th className="px-2 py-2 text-right">數量</th>
              <th className="px-2 py-2 text-right">金額</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="px-2 py-2">{i.name}</td>
                <td className="px-2 py-2 text-right text-zinc-600">{i.unitPrice}</td>
                <td className="px-2 py-2 text-right">{i.qty}</td>
                <td className="px-2 py-2 text-right">{i.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t text-sm">
              <td className="px-2 py-2 text-xs text-zinc-500">合計 {totalQty} 件</td>
              <td />
              <td className="px-2 py-2 text-right text-zinc-500">小計</td>
              <td className="px-2 py-2 text-right">{Number(order.subtotal).toLocaleString()}</td>
            </tr>
            <tr>
              <td colSpan={2} />
              <td className="px-2 py-1 text-right text-zinc-500">運費</td>
              <td className="px-2 py-1 text-right">
                {Number(order.shipping_fee).toLocaleString()}
              </td>
            </tr>
            <tr className="border-t-2 border-[#10305a]">
              <td colSpan={2} />
              <td className="px-2 py-2 text-right font-semibold">應付金額</td>
              <td className="px-2 py-2 text-right text-lg font-bold text-[#10305a]">
                NT$ {Number(order.total).toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>

        {order.notes && (
          <p className="mb-4 text-sm">
            <span className="text-zinc-500">備註：</span>
            {order.notes}
          </p>
        )}

        <div className="border-t pt-3 text-xs leading-6 text-zinc-500">
          <p>誠真生活 | realreal.cc | love@realreal.cc | Line 真人客服 @900kevgi</p>
          <p>本單金額均含稅。如商品或金額有疑義，請於收貨後三日內聯繫我們。</p>
        </div>
      </div>
    </div>
  )
}
