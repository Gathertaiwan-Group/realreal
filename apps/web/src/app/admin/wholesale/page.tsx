"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"
import { API_URL } from "@/lib/api-url"

/**
 * 通路商總覽。
 *
 * 五家實體通路（藥局、蔬食店）目前都用 LINE／電話下單，再由人手動輸入系統。
 * 這一頁與底下的通路商明細頁，是把那個流程搬進系統的第一步。
 */

type Channel = {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  tax_id: string | null
  payment_terms: "on_receipt_3d" | "month_end"
  is_active: boolean
  notes: string | null
  overrideCount: number
  unavailableCount: number
}

type WholesaleOrder = {
  id: string
  order_number: string
  channel_name: string
  status_label: string
  total: number
  created_at: string
  wholesale_paid_at: string | null
}

const TERMS_LABEL: Record<string, string> = {
  on_receipt_3d: "收貨後 3 個工作天",
  month_end: "月底結",
}

export default function WholesalePage() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [orders, setOrders] = useState<WholesaleOrder[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [cRes, oRes] = await Promise.all([
          adminFetch(`${API_URL}/admin/wholesale/channels`),
          adminFetch(`${API_URL}/admin/wholesale/orders`),
        ])
        const [cJson, oJson] = await Promise.all([cRes.json(), oRes.json()])
        if (cancelled) return
        if (!cRes.ok) toast.error(cJson.error ?? "讀取通路商失敗")
        setChannels(cJson.channels ?? [])
        setOrders(oJson.orders ?? [])
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "讀取失敗")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-[#10305a]">通路商</h1>
      <p className="mb-6 text-sm text-[#687279]">
        批發訂單與零售訂單完全分開計算，不會互相影響報表。
      </p>

      <div className="mb-10 overflow-hidden rounded-[10px] border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-xs uppercase text-[#687279]">
            <tr>
              <th className="px-4 py-3 text-left">通路商</th>
              <th className="px-4 py-3 text-left">聯絡人</th>
              <th className="px-4 py-3 text-left">統編</th>
              <th className="px-4 py-3 text-left">付款條件</th>
              <th className="px-4 py-3 text-left">價目</th>
              <th className="px-4 py-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {channels === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  讀取中…
                </td>
              </tr>
            ) : channels.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  尚無通路商
                </td>
              </tr>
            ) : (
              channels.map((c) => (
                <tr key={c.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/wholesale/${c.id}`}
                      className="font-medium text-[#10305a] hover:underline"
                    >
                      {c.name}
                    </Link>
                    {!c.is_active && (
                      <span className="ml-2 rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        停用
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{c.contact_name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                    {c.tax_id ?? <span className="text-amber-600">待補</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {TERMS_LABEL[c.payment_terms]}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {c.overrideCount === 0 ? (
                      <span className="text-zinc-400">全部標準價</span>
                    ) : (
                      <>
                        {c.overrideCount - c.unavailableCount > 0 && (
                          <span>{c.overrideCount - c.unavailableCount} 項例外價</span>
                        )}
                        {c.unavailableCount > 0 && (
                          <span className="ml-2 text-amber-600">
                            {c.unavailableCount} 項不供貨
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/wholesale/${c.id}`}
                      className="text-xs font-medium text-[#10305a] hover:underline"
                    >
                      價目 / 建單
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 text-lg font-semibold text-[#10305a]">批發訂單</h2>
      <div className="overflow-hidden rounded-[10px] border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-xs uppercase text-[#687279]">
            <tr>
              <th className="px-4 py-3 text-left">訂單號</th>
              <th className="px-4 py-3 text-left">通路商</th>
              <th className="px-4 py-3 text-left">狀態</th>
              <th className="px-4 py-3 text-right">金額</th>
              <th className="px-4 py-3 text-left">收款</th>
              <th className="px-4 py-3 text-left">日期</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {!orders || orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  尚無批發訂單
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="hover:bg-zinc-50">
                  <td className="px-4 py-3 font-mono text-xs">{o.order_number}</td>
                  <td className="px-4 py-3">{o.channel_name}</td>
                  <td className="px-4 py-3 text-xs">{o.status_label}</td>
                  <td className="px-4 py-3 text-right">
                    NT$ {Number(o.total).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {o.wholesale_paid_at ? (
                      <span className="text-green-700">已收款</span>
                    ) : (
                      <span className="text-amber-600">未收款</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {new Date(o.created_at).toLocaleDateString("zh-TW")}
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
