"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { adminFetch } from "@/lib/admin-fetch"
import { API_URL } from "@/lib/api-url"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

type Customer = {
  user_id: string
  display_name: string | null
  phone: string | null
  email: string | null
  total_spend: number | null
  charity_savings: number | null
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
      <div className="mb-6 flex items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-[#10305a]">客戶管理</h1>
        <BirthdayInviteButton />
      </div>
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
              <th className="px-4 py-3 text-right font-medium">公益存款</th>
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
                // 顯示「公益存款」= user_profiles.charity_savings (from 6/30
                // VIP CSV)。points_balance 屬於未來的交易點數系統，跟 6/30
                // 累積數字是不同概念，暫時不顯示。
                const savings = Number(c.charity_savings ?? 0)
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
                        (savings > 0 ? "text-[#10305a]" : "text-gray-400")
                      }
                    >
                      NT$ {savings.toLocaleString()}
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

/**
 * 邀請還沒填生日的會員去補填。
 *
 * 兩段式：先「預覽名單」（dryRun，一封都不寄），確認人數與金額分布之後才送出。
 * 群發沒有復原鍵，所以送出前一定要有人看過名單 —— 2026-08-31 那次就是沒人看過
 * 的批次寄了 20 封錯誤通知給幾個月前的舊訂單。
 */
function BirthdayInviteButton() {
  type Recipient = { name: string; email: string; tier: string; gift: number }
  const [preview, setPreview] = useState<Recipient[] | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(dryRun: boolean) {
    setBusy(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/customers/birthday-invite`, {
        method: "POST",
        body: JSON.stringify({ dryRun }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "執行失敗")
        return
      }
      if (dryRun) {
        setPreview(json.recipients ?? [])
        if ((json.total ?? 0) === 0) toast.info("目前沒有需要邀請的會員")
      } else {
        toast.success(`已寄出 ${json.sentCount} 封邀請信`, {
          description:
            json.failedCount > 0
              ? `${json.failedCount} 封失敗：${(json.failed ?? []).map((f: { email: string }) => f.email).join("、")}`
              : undefined,
          duration: json.failedCount > 0 ? 30000 : 6000,
        })
        setPreview(null)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "執行失敗")
    } finally {
      setBusy(false)
    }
  }

  if (!preview) {
    return (
      <button
        type="button"
        onClick={() => run(true)}
        disabled={busy}
        className="rounded-[10px] border border-[#10305a]/20 bg-white px-3 py-1.5 text-sm text-[#10305a] hover:bg-[#10305a]/5 disabled:opacity-50"
      >
        {busy ? "讀取中…" : "邀請補填生日"}
      </button>
    )
  }

  const byTier = preview.reduce<Record<string, number>>((acc, r) => {
    acc[r.tier] = (acc[r.tier] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="w-80 rounded-lg border bg-white p-3 text-sm shadow-sm">
      <p className="mb-1 font-medium text-[#10305a]">將寄給 {preview.length} 位會員</p>
      <ul className="mb-2 space-y-0.5 text-xs text-zinc-600">
        {Object.entries(byTier).map(([tier, n]) => (
          <li key={tier}>
            {tier} {n} 位 — 禮金 NT${preview.find((r) => r.tier === tier)?.gift}
          </li>
        ))}
      </ul>
      <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
        只寄給「還沒填生日」的一般會員。已填過的人不會收到，所以重複執行是安全的。
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setPreview(null)}
          disabled={busy}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => run(false)}
          disabled={busy || preview.length === 0}
          className="rounded-[10px] bg-[#10305a] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? "寄送中…" : `確定寄出 ${preview.length} 封`}
        </button>
      </div>
    </div>
  )
}
