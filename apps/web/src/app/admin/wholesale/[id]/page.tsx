"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"
import { API_URL } from "@/lib/api-url"

/**
 * 單一通路商：基本資料、價目表、代客建單。
 *
 * 價目表顯示的是「標準價套上這家差異」之後的實際成交價。每一列都能改價或標記
 * 不供貨，也能按「恢復標準」把差異刪掉 —— 那顆按鈕不是裝飾：如果把「跟標準相同」
 * 也存成一列例外，它跟「剛好談到同一個數字」在畫面上就分不出來，日後調整標準價
 * 時後者不會跟著變。
 */

type Channel = {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_id: string | null
  payment_terms: "on_receipt_3d" | "month_end"
  msrp_floor_sachet: number | null
  msrp_floor_pouch: number | null
  notes: string | null
  is_active: boolean
}

type Item = {
  variantId: string
  productName: string
  stockQty: number
  listPrice: number
  standardPrice: number
  price: number
  isAvailable: boolean
  isOverridden: boolean
}

export default function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [channel, setChannel] = useState<Channel | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [boxes, setBoxes] = useState(1)
  const [orderNotes, setOrderNotes] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await adminFetch(`${API_URL}/admin/wholesale/channels/${id}`)
    const json = await res.json()
    if (!res.ok) {
      toast.error(json.error ?? "讀取失敗")
      return
    }
    setChannel(json.channel)
    setItems(json.items ?? [])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function saveItem(variantId: string, wholesalePrice: number | null, isAvailable: boolean) {
    const res = await adminFetch(`${API_URL}/admin/wholesale/channels/${id}/items/${variantId}`, {
      method: "PUT",
      body: JSON.stringify({ wholesalePrice, isAvailable }),
    })
    const json = await res.json()
    if (!res.ok) {
      toast.error(json.error ?? "儲存失敗")
      return
    }
    toast.success(json.restoredToStandard ? "已恢復標準價" : "已更新")
    load()
  }

  const lines = items.filter((i) => (cart[i.variantId] ?? 0) > 0)
  const subtotal = lines.reduce((s, i) => s + i.price * (cart[i.variantId] ?? 0), 0)
  const shippingFee = subtotal >= 4000 ? 0 : Math.max(0, boxes) * 150
  const total = subtotal + shippingFee

  async function createOrder() {
    setBusy(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/wholesale/orders`, {
        method: "POST",
        body: JSON.stringify({
          channelId: id,
          items: lines.map((i) => ({ variantId: i.variantId, qty: cart[i.variantId] })),
          boxes,
          notes: orderNotes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "建立訂單失敗")
        return
      }
      toast.success(`訂單 ${json.order.orderNumber} 已建立`, {
        description: `小計 NT$${json.order.subtotal.toLocaleString()}、運費 NT$${json.order.shippingFee}、合計 NT$${json.order.total.toLocaleString()}`,
        duration: 10000,
      })
      setCart({})
      setOrderNotes("")
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!channel) return <p className="text-sm text-zinc-500">讀取中…</p>

  return (
    <div>
      <Link href="/admin/wholesale" className="text-xs text-[#10305a] hover:underline">
        ← 通路商列表
      </Link>
      <h1 className="mb-1 mt-2 text-xl font-semibold text-[#10305a]">{channel.name}</h1>
      <p className="mb-6 text-sm text-[#687279]">
        {channel.contact_name ?? "聯絡人待補"}　·　統編{" "}
        {channel.tax_id ?? <span className="text-amber-600">待補</span>}　·
        {channel.payment_terms === "month_end" ? "月底結" : "收貨後 3 個工作天"}
        {channel.msrp_floor_sachet != null && (
          <>
            　·　轉售下限 隨身包 {channel.msrp_floor_sachet}／夾鏈袋{" "}
            {channel.msrp_floor_pouch}
          </>
        )}
      </p>
      {channel.notes && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {channel.notes}
        </p>
      )}

      <h2 className="mb-2 text-lg font-semibold text-[#10305a]">價目表與建單</h2>
      <p className="mb-3 text-xs text-zinc-500">
        在「數量」填入件數即可建單；金額依這家的成交價自動計算。
      </p>

      <div className="overflow-hidden rounded-[10px] border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-xs uppercase text-[#687279]">
            <tr>
              <th className="px-3 py-3 text-left">品項</th>
              <th className="px-3 py-3 text-right">定價</th>
              <th className="px-3 py-3 text-right">標準價</th>
              <th className="px-3 py-3 text-right">這家的價格</th>
              <th className="px-3 py-3 text-right">庫存</th>
              <th className="px-3 py-3 text-center">數量</th>
              <th className="px-3 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {items.map((i) => (
              <tr key={i.variantId} className={i.isAvailable ? "" : "bg-zinc-50/60"}>
                <td className="px-3 py-2">
                  {i.productName}
                  {!i.isAvailable && (
                    <span className="ml-2 rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      不供貨
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-zinc-500">{i.listPrice}</td>
                <td className="px-3 py-2 text-right text-zinc-500">{i.standardPrice}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    defaultValue={i.price}
                    min={1}
                    disabled={!i.isAvailable}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (!Number.isFinite(v) || v === i.price) return
                      saveItem(i.variantId, v, true)
                    }}
                    className={`w-20 rounded border px-2 py-1 text-right ${
                      i.isOverridden && i.isAvailable
                        ? "border-[#10305a] font-semibold text-[#10305a]"
                        : "border-zinc-200"
                    }`}
                  />
                </td>
                <td className="px-3 py-2 text-right text-xs text-zinc-500">{i.stockQty}</td>
                <td className="px-3 py-2 text-center">
                  <input
                    type="number"
                    min={0}
                    value={cart[i.variantId] ?? ""}
                    disabled={!i.isAvailable}
                    onChange={(e) =>
                      setCart((c) => ({ ...c, [i.variantId]: Number(e.target.value) || 0 }))
                    }
                    className="w-16 rounded border border-zinc-200 px-2 py-1 text-center disabled:bg-zinc-100"
                  />
                </td>
                <td className="px-3 py-2 text-xs">
                  <button
                    type="button"
                    onClick={() => saveItem(i.variantId, null, !i.isAvailable)}
                    className="text-[#10305a] hover:underline"
                  >
                    {i.isAvailable ? "設為不供貨" : "恢復供貨"}
                  </button>
                  {i.isOverridden && i.isAvailable && (
                    <button
                      type="button"
                      onClick={() => saveItem(i.variantId, null, true)}
                      className="ml-3 text-zinc-500 hover:underline"
                    >
                      恢復標準價
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 rounded-[10px] border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end gap-4">
          <label className="text-sm">
            <span className="mr-2 text-zinc-600">箱數</span>
            <input
              type="number"
              min={0}
              value={boxes}
              onChange={(e) => setBoxes(Number(e.target.value) || 0)}
              className="w-20 rounded border border-zinc-200 px-2 py-1"
            />
          </label>
          <label className="flex-1 text-sm">
            <span className="mr-2 text-zinc-600">備註</span>
            <input
              type="text"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="例如：指定到貨日"
              className="w-full rounded border border-zinc-200 px-2 py-1"
            />
          </label>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="text-sm text-zinc-600">
            {lines.length === 0 ? (
              <span className="text-zinc-400">尚未選擇品項</span>
            ) : (
              <>
                <div>{lines.length} 個品項，小計 NT$ {subtotal.toLocaleString()}</div>
                <div>
                  運費 NT$ {shippingFee}
                  {shippingFee === 0 && subtotal > 0 && (
                    <span className="ml-1 text-green-700">（滿 4,000 免運）</span>
                  )}
                </div>
                <div className="mt-1 text-base font-semibold text-[#10305a]">
                  合計 NT$ {total.toLocaleString()}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={createOrder}
            disabled={busy || lines.length === 0}
            className="rounded-[10px] bg-[#10305a] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "建立中…" : "建立訂單"}
          </button>
        </div>
      </div>
    </div>
  )
}
