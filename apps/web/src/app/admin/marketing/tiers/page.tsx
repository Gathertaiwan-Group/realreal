"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react"
import { adminFetch } from "@/lib/admin-fetch"
import { AdminTabs } from "../../_components/AdminTabs"

// ---------------------------------------------------------------------------
// Marketing tabs (kept in sync with /admin/campaigns + /admin/coupons)
// ---------------------------------------------------------------------------

const MARKETING_TABS = [
  { href: "/admin/campaigns", label: "行銷活動" },
  { href: "/admin/coupons", label: "優惠券" },
  { href: "/admin/marketing/tiers", label: "會員等級" },
  { href: "/admin/marketing/points", label: "點數規則" },
]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Tier {
  id: string
  name: string
  min_spend: number
  discount_rate: number      // 0..1 decimal (existing convention)
  rebate_rate: number        // percent points (e.g., 2.3 = 2.3%) — new top-level column per spec 0017
  sort_order: number
  tagline: string
  perks: string[]
  validity_months: number
  requalify_amount: number
  requalify_window_months: number
}

interface LinkedCampaign {
  id: string
  name: string
  type: string
  starts_at: string | null
  ends_at: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminMarketingTiersPage() {
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTiers = useCallback(async () => {
    try {
      const res = await adminFetch(`${API_URL}/membership-tiers`)
      if (res.ok) {
        const data = await res.json()
        const rows: Tier[] = Array.isArray(data) ? data : data.data ?? []
        // Normalise: tolerate missing / legacy fields. perks may arrive as
        // null, an array, or a JSON string depending on the API path used.
        const normalised = rows.map((t) => {
          let perks: string[] = []
          const raw = (t as { perks?: unknown }).perks
          if (Array.isArray(raw)) {
            perks = raw.filter((x): x is string => typeof x === "string")
          } else if (typeof raw === "string") {
            try {
              const parsed = JSON.parse(raw)
              if (Array.isArray(parsed)) {
                perks = parsed.filter((x): x is string => typeof x === "string")
              }
            } catch {
              perks = []
            }
          }
          return {
            ...t,
            rebate_rate: Number(t.rebate_rate ?? 0),
            discount_rate: Number(t.discount_rate ?? 0),
            min_spend: Number(t.min_spend ?? 0),
            sort_order: Number(t.sort_order ?? 0),
            tagline: typeof t.tagline === "string" ? t.tagline : "",
            perks,
            validity_months: Number(t.validity_months ?? 0),
            requalify_amount: Number(t.requalify_amount ?? 0),
            requalify_window_months: Number(t.requalify_window_months ?? 6),
          }
        })
        // Sort by sort_order ascending so the table shows lowest tier first.
        normalised.sort((a, b) => a.sort_order - b.sort_order)
        setTiers(normalised)
      }
    } catch {
      toast.error("無法載入等級資料")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTiers()
  }, [fetchTiers])

  // -- PATCH a single tier ---------------------------------------------------
  // Existing API exposes PUT /admin/membership-tiers/:id (zod partial schema),
  // semantically equivalent to PATCH for our usage.
  async function patchTier(id: string, changes: Partial<Tier>) {
    try {
      const res = await adminFetch(`${API_URL}/admin/membership-tiers/${id}`, {
        method: "PUT",
        body: JSON.stringify(changes),
      })
      if (!res.ok) throw new Error()
      toast.success("已儲存")
      // Optimistically merge locally to avoid full refetch flash.
      setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)))
    } catch {
      toast.error("儲存失敗")
      // Reload to reset any optimistic UI drift.
      fetchTiers()
    }
  }

  // -- DELETE a tier ---------------------------------------------------------
  async function deleteTier(id: string, name: string) {
    if (!confirm(`確定要刪除等級「${name}」？`)) return
    try {
      const res = await adminFetch(`${API_URL}/admin/membership-tiers/${id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "刪除失敗")
      }
      toast.success("已刪除")
      setTiers((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗")
    }
  }

  // -- CREATE new tier -------------------------------------------------------
  async function createTier() {
    const nextSort = tiers.length > 0 ? Math.max(...tiers.map((t) => t.sort_order)) + 1 : 1
    try {
      const res = await adminFetch(`${API_URL}/admin/membership-tiers`, {
        method: "POST",
        body: JSON.stringify({
          name: "新等級",
          min_spend: 0,
          discount_rate: 0,
          rebate_rate: 0,
          tagline: "",
          perks: [],
          validity_months: 0,
          requalify_amount: 0,
          requalify_window_months: 6,
          sort_order: nextSort,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success("已新增等級")
      await fetchTiers()
    } catch {
      toast.error("新增失敗")
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-xl font-semibold text-[#10305a]">行銷</h1>
        <AdminTabs tabs={MARKETING_TABS} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-[#687279]">
          欄位點擊可直接編輯，按 Enter 或失焦會自動儲存。
        </p>
        <Button
          size="sm"
          onClick={createTier}
          className="bg-[#10305a] hover:bg-[#10305a]/90 rounded-[10px]"
        >
          <Plus className="w-4 h-4 mr-1" />
          新增等級
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500 text-xs">
            <tr>
              <th className="w-8 px-2 py-3"></th>
              <th className="px-4 py-3 text-left">名稱</th>
              <th className="px-4 py-3 text-left">標語</th>
              <th className="px-4 py-3 text-right">升等門檻 NT$</th>
              <th className="px-4 py-3 text-right">自動折扣 %</th>
              <th className="px-4 py-3 text-right">點數回饋 %</th>
              <th className="px-4 py-3 text-right">有效月</th>
              <th className="px-4 py-3 text-right">達標金額 NT$</th>
              <th className="px-4 py-3 text-right">達標窗口月</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-zinc-400">
                  載入中…
                </td>
              </tr>
            ) : tiers.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-zinc-400">
                  尚未建立任何等級，點擊上方「新增等級」開始
                </td>
              </tr>
            ) : (
              tiers.map((tier) => (
                <TierRow
                  key={tier.id}
                  tier={tier}
                  onSave={(changes) => patchTier(tier.id, changes)}
                  onDelete={() => deleteTier(tier.id, tier.name)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TierRow — each cell click-to-edit, Enter/blur commits.
// Row expands to reveal perks editor + read-only linked-campaigns list.
// ---------------------------------------------------------------------------

function TierRow({
  tier,
  onSave,
  onDelete,
}: {
  tier: Tier
  onSave: (changes: Partial<Tier>) => void | Promise<void>
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [linked, setLinked] = useState<LinkedCampaign[] | null>(null)
  const [linkedLoading, setLinkedLoading] = useState(false)

  // Lazy-fetch linked campaigns on first expand; re-fetch each open keeps
  // the list fresh after admin edits campaigns in another tab.
  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    setLinkedLoading(true)
    adminFetch(`${API_URL}/tiers/${tier.id}/linked-campaigns`)
      .then(async (res) => {
        if (!res.ok) throw new Error()
        const body = await res.json()
        const rows: LinkedCampaign[] = Array.isArray(body) ? body : body.data ?? []
        if (!cancelled) setLinked(rows)
      })
      .catch(() => {
        if (!cancelled) setLinked([])
      })
      .finally(() => {
        if (!cancelled) setLinkedLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, tier.id])

  return (
    <>
      <tr className="hover:bg-zinc-50">
        <td className="px-2 py-3 align-middle">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-zinc-100 text-zinc-500"
            title={expanded ? "收合" : "展開"}
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </td>
        <td className="px-4 py-3 font-medium text-[#10305a]">
          <InlineText
            value={tier.name}
            onCommit={(v) => {
              const trimmed = v.trim()
              if (!trimmed || trimmed === tier.name) return
              onSave({ name: trimmed })
            }}
          />
        </td>
        <td className="px-4 py-3 text-zinc-600">
          <InlineText
            value={tier.tagline}
            onCommit={(v) => {
              if (v === tier.tagline) return
              onSave({ tagline: v })
            }}
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <InlineNumber
            value={tier.min_spend}
            align="right"
            onCommit={(v) => {
              if (v === tier.min_spend) return
              onSave({ min_spend: v })
            }}
            render={(v) => `NT$ ${v.toLocaleString()}`}
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <InlineNumber
            value={Math.round(tier.discount_rate * 100)}
            align="right"
            step={1}
            min={0}
            max={100}
            onCommit={(v) => {
              const decimal = Math.max(0, Math.min(100, v)) / 100
              if (decimal === tier.discount_rate) return
              onSave({ discount_rate: decimal })
            }}
            render={(v) => `${v}%`}
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <InlineNumber
            value={tier.rebate_rate}
            align="right"
            step={0.1}
            min={0}
            max={100}
            onCommit={(v) => {
              const clamped = Math.max(0, Math.min(100, v))
              if (clamped === tier.rebate_rate) return
              onSave({ rebate_rate: clamped })
            }}
            render={(v) => `${v}%`}
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <InlineNumber
            value={tier.validity_months}
            align="right"
            step={1}
            min={0}
            onCommit={(v) => {
              const clamped = Math.max(0, Math.round(v))
              if (clamped === tier.validity_months) return
              onSave({ validity_months: clamped })
            }}
            render={(v) => (v === 0 ? "永久" : `${v} 月`)}
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <InlineNumber
            value={tier.requalify_amount}
            align="right"
            step={1}
            min={0}
            onCommit={(v) => {
              const clamped = Math.max(0, v)
              if (clamped === tier.requalify_amount) return
              onSave({ requalify_amount: clamped })
            }}
            render={(v) => `NT$ ${v.toLocaleString()}`}
          />
        </td>
        <td className="px-4 py-3 text-right tabular-nums">
          <InlineNumber
            value={tier.requalify_window_months}
            align="right"
            step={1}
            min={0}
            onCommit={(v) => {
              const clamped = Math.max(0, Math.round(v))
              if (clamped === tier.requalify_window_months) return
              onSave({ requalify_window_months: clamped })
            }}
            render={(v) => `${v} 月`}
          />
        </td>
        <td className="px-4 py-3 text-center">
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-50 text-zinc-500 hover:text-red-600"
            title="刪除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-zinc-50/60">
          <td colSpan={10} className="px-6 py-4">
            <div className="grid gap-6 md:grid-cols-2">
              <PerksEditor
                value={tier.perks}
                onSave={(perks) => onSave({ perks })}
              />
              <LinkedCampaignsPanel loading={linkedLoading} campaigns={linked} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// PerksEditor — textarea, one perk per line. Blank lines tolerated while
// editing; we filter them out on save so storage stays a clean JSON array.
// ---------------------------------------------------------------------------

function PerksEditor({
  value,
  onSave,
}: {
  value: string[]
  onSave: (next: string[]) => void | Promise<void>
}) {
  const joined = value.join("\n")
  const [draft, setDraft] = useState(joined)
  const [dirty, setDirty] = useState(false)

  // Sync external updates (e.g., after refetch) when the user isn't editing.
  useEffect(() => {
    if (!dirty) setDraft(joined)
  }, [joined, dirty])

  function commit() {
    if (!dirty) return
    const next = draft
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    setDirty(false)
    // Avoid no-op save when nothing actually changed after trimming.
    if (next.length === value.length && next.every((v, i) => v === value[i])) {
      setDraft(next.join("\n"))
      return
    }
    onSave(next)
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#10305a]">權益條目</h3>
        <span className="text-xs text-zinc-400">每行一條,空白行會被忽略</span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setDirty(true)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(joined)
            setDirty(false)
            ;(e.target as HTMLTextAreaElement).blur()
          }
        }}
        rows={6}
        placeholder="例如:&#10;常態 95 折&#10;消費金額 3.3% 累積為公益存款&#10;生日當月消費 9 折"
        className="w-full text-sm rounded-[6px] border border-zinc-200 px-3 py-2 focus:outline-none focus:border-[#10305a] resize-y"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// LinkedCampaignsPanel — read-only list of campaigns auto-linked to this
// tier. Editing happens in the 行銷活動 tab, not here.
// ---------------------------------------------------------------------------

function LinkedCampaignsPanel({
  loading,
  campaigns,
}: {
  loading: boolean
  campaigns: LinkedCampaign[] | null
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-[#10305a]">自動連動活動</h3>
      </div>
      <div className="rounded-[6px] border border-zinc-200 bg-white p-3 min-h-[8rem]">
        {loading ? (
          <p className="text-xs text-zinc-400">載入中…</p>
        ) : !campaigns || campaigns.length === 0 ? (
          <p className="text-xs text-zinc-400">尚無連動活動</p>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <Link
                  href={`/admin/campaigns/${c.id}`}
                  className="text-[#10305a] hover:underline truncate"
                >
                  {c.name}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className="bg-zinc-100 text-zinc-600 font-normal text-xs">
                    {c.type}
                  </Badge>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {formatRange(c.starts_at, c.ends_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 text-xs text-zinc-400">
        這些活動為自動連動,刪除或停用請至「行銷活動」tab
      </p>
    </div>
  )
}

function formatRange(start: string | null, end: string | null): string {
  const fmt = (iso: string | null) => {
    if (!iso) return "—"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}/${m}/${day}`
  }
  return `${fmt(start)} ~ ${fmt(end)}`
}

// ---------------------------------------------------------------------------
// Inline editors — share the "click → edit → Enter/blur to commit" pattern
// ---------------------------------------------------------------------------

function InlineText({
  value,
  onCommit,
}: {
  value: string
  onCommit: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left hover:bg-[#fffeee] rounded px-1 py-0.5 -mx-1 -my-0.5"
      >
        {value || <span className="text-zinc-400">（點擊編輯）</span>}
      </button>
    )
  }

  function commit() {
    setEditing(false)
    onCommit(draft)
  }

  return (
    <Input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          commit()
        } else if (e.key === "Escape") {
          setDraft(value)
          setEditing(false)
        }
      }}
      className="h-7 text-sm rounded-[6px]"
    />
  )
}

function InlineNumber({
  value,
  onCommit,
  align = "left",
  step = 1,
  min,
  max,
  render,
}: {
  value: number
  onCommit: (next: number) => void
  align?: "left" | "right"
  step?: number
  min?: number
  max?: number
  render?: (v: number) => string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => setDraft(String(value)), [value])
  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`${
          align === "right" ? "text-right" : "text-left"
        } hover:bg-[#fffeee] rounded px-1 py-0.5 -mx-1 -my-0.5 w-full block`}
      >
        {render ? render(value) : value.toLocaleString()}
      </button>
    )
  }

  function commit() {
    setEditing(false)
    const n = Number(draft)
    if (Number.isFinite(n)) onCommit(n)
  }

  return (
    <Input
      ref={ref}
      type="number"
      step={step}
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          commit()
        } else if (e.key === "Escape") {
          setDraft(String(value))
          setEditing(false)
        }
      }}
      className={`h-7 text-sm rounded-[6px] ${align === "right" ? "text-right" : ""}`}
    />
  )
}

