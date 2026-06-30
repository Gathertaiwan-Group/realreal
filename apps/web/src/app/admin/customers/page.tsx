"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { adminFetch } from "@/lib/admin-fetch"
import { API_URL } from "@/lib/api-url"
import { Badge } from "@/components/ui/badge"

type Customer = {
  user_id: string
  display_name: string | null
  phone: string | null
  email: string | null
  total_spend: number | null
  created_at: string
  tier_name: string | null
  points_balance: number
}

type SortKey = "created_at" | "display_name"
type SortDir = "asc" | "desc"

function SortArrow({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span
      className={
        "ml-1 inline-block text-[9px] align-middle " +
        (active ? "text-[#10305a]" : "text-gray-400")
      }
    >
      {active ? (dir === "asc" ? "▲" : "▼") : "▲"}
    </span>
  )
}

export default function AdminCustomersPage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortKey, setSortKey] = useState<SortKey>("created_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await adminFetch(`${API_URL}/admin/customers`)
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        const list = (json?.data as Customer[] | undefined) ?? []
        setCustomers(list)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      // 加入日期預設新到舊；姓名預設 A→Z（依筆劃／拼音）
      setSortDir(key === "created_at" ? "desc" : "asc")
    }
  }

  const sorted = useMemo(() => {
    if (!customers) return null
    const arr = [...customers]
    arr.sort((a, b) => {
      if (sortKey === "display_name") {
        const an = a.display_name?.trim() ?? ""
        const bn = b.display_name?.trim() ?? ""
        // 沒有姓名的一律排最後（不受升降序影響）
        if (!an && !bn) return 0
        if (!an) return 1
        if (!bn) return -1
        const cmp = an.localeCompare(bn, "zh-Hant")
        return sortDir === "asc" ? cmp : -cmp
      }
      const cmp =
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sortDir === "asc" ? cmp : -cmp
    })
    return arr
  }, [customers, sortKey, sortDir])

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6 text-[#10305a]">客戶管理</h1>
      <p className="text-sm text-[#687279] mb-4">
        共 {customers?.length ?? 0} 位客戶
      </p>
      <div className="border rounded-[10px] overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-[#10305a] text-xs">
            <tr>
              <th className="px-4 py-3 text-left font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("display_name")}
                  title="點擊排序"
                  className="inline-flex items-center cursor-pointer hover:text-[#10305a]/70"
                >
                  姓名
                  <SortArrow active={sortKey === "display_name"} dir={sortDir} />
                </button>
              </th>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">電話</th>
              <th className="px-4 py-3 text-left font-medium">會員等級</th>
              <th className="px-4 py-3 text-right font-medium">累計消費</th>
              <th className="px-4 py-3 text-right font-medium">點數餘額</th>
              <th className="px-4 py-3 text-left font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("created_at")}
                  title="點擊排序"
                  className="inline-flex items-center cursor-pointer hover:text-[#10305a]/70"
                >
                  加入日期
                  <SortArrow active={sortKey === "created_at"} dir={sortDir} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#687279]">
                  載入中…
                </td>
              </tr>
            ) : !sorted || sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[#687279]">
                  暫無客戶資料
                </td>
              </tr>
            ) : (
              sorted.map((c) => {
                const balance = c.points_balance ?? 0
                return (
                  <tr
                    key={c.user_id}
                    onClick={() => router.push(`/admin/customers/${c.user_id}`)}
                    className="cursor-pointer hover:bg-[#fffeee]/50 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#10305a]">
                        {c.display_name ?? "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-[#687279] break-all">
                      {c.email || "—"}
                    </td>
                    <td className="px-4 py-3 text-[#687279]">{c.phone || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className="border-[#10305a]/20 text-[#10305a]"
                      >
                        {c.tier_name ?? "一般會員"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-[#10305a] font-medium">
                      NT$ {Number(c.total_spend ?? 0).toLocaleString()}
                    </td>
                    <td
                      className={
                        "px-4 py-3 text-right font-medium " +
                        (balance > 0 ? "text-[#10305a]" : "text-gray-400")
                      }
                    >
                      {balance.toLocaleString()} 點
                    </td>
                    <td className="px-4 py-3 text-[#687279] text-xs">
                      {new Date(c.created_at).toLocaleDateString("zh-TW")}
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
