"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
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
// Types — mirrors the lifted constant from /admin/membership/page.tsx
// ---------------------------------------------------------------------------

const BENEFIT_OPTIONS = [
  { key: "free_shipping", label: "免運費" },
  { key: "birthday_coupon", label: "生日優惠券" },
  { key: "early_access", label: "搶先購買" },
  { key: "points_multiplier", label: "點數加倍" },
  { key: "vip_support", label: "VIP 客服" },
] as const

type BenefitKey = (typeof BENEFIT_OPTIONS)[number]["key"]

interface Tier {
  id: string
  name: string
  min_spend: number
  discount_rate: number      // 0..1 decimal (existing convention)
  rebate_rate: number        // percent points (e.g., 2.3 = 2.3%) — new top-level column per spec 0017
  sort_order: number
  benefits: BenefitKey[]
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
        // Normalise: benefits may arrive as an object {} (legacy) or array;
        // editor below assumes BenefitKey[].
        const normalised = rows.map((t) => ({
          ...t,
          benefits: Array.isArray(t.benefits) ? t.benefits : [],
          rebate_rate: Number(t.rebate_rate ?? 0),
          discount_rate: Number(t.discount_rate ?? 0),
          min_spend: Number(t.min_spend ?? 0),
          sort_order: Number(t.sort_order ?? 0),
        }))
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
          benefits: [],
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
              <th className="px-4 py-3 text-left">名稱</th>
              <th className="px-4 py-3 text-right">升等門檻 NT$</th>
              <th className="px-4 py-3 text-right">自動折扣 %</th>
              <th className="px-4 py-3 text-right">點數回饋 %</th>
              <th className="px-4 py-3 text-left">其他權益</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-400">
                  載入中…
                </td>
              </tr>
            ) : tiers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-400">
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
// TierRow — each cell click-to-edit, Enter/blur commits
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
  return (
    <tr className="hover:bg-zinc-50">
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
      <td className="px-4 py-3">
        <BenefitChecklist
          value={tier.benefits ?? []}
          onChange={(benefits) => onSave({ benefits })}
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
  )
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

function BenefitChecklist({
  value,
  onChange,
}: {
  value: BenefitKey[]
  onChange: (next: BenefitKey[]) => void
}) {
  // Render as clickable badges — single source of truth, immediate commit on toggle.
  return (
    <div className="flex flex-wrap gap-1.5">
      {BENEFIT_OPTIONS.map((b) => {
        const checked = value.includes(b.key)
        return (
          <button
            key={b.key}
            type="button"
            onClick={() => {
              const next = checked
                ? value.filter((k) => k !== b.key)
                : [...value, b.key]
              onChange(next)
            }}
            className="focus:outline-none"
          >
            <Badge
              className={`cursor-pointer text-xs font-normal transition-colors ${
                checked
                  ? "bg-[#10305a] text-white hover:bg-[#10305a]/90"
                  : "bg-zinc-100 text-zinc-400 hover:bg-zinc-200"
              }`}
            >
              {checked ? "✓ " : ""}
              {b.label}
            </Badge>
          </button>
        )
      })}
    </div>
  )
}
