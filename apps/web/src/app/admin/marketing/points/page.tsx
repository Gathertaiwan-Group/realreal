"use client"

import { useCallback, useEffect, useState } from "react"
import { Save, Settings as SettingsIcon } from "lucide-react"
import { toast } from "sonner"

import { adminFetch } from "@/lib/admin-fetch"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdminTabs } from "../../_components/AdminTabs"

/**
 * /admin/marketing/points — 點數規則 tab.
 *
 * Spec: docs/superpowers/specs/2026-05-30-D-points-rules-simplification-design.md
 *   Section 1 — admin UI 砍欄位
 *
 * Three cards:
 *   1. 點數規則 form — edit 2 `points.*` keys (ratio + expire_days) via
 *      PUT /admin/settings
 *   2. 目前狀態 read-only — counts/sums pulled from v_user_points_balance
 *      view and points_ledger (expiring-soon).
 *   3. 折抵預設行為 hint — documents the 5 hardcoded defaults that used
 *      to be settings (min_redeem / max_redeem_pct / allow_coupon_stack /
 *      apply_to_shipping / apply_to_sale).
 *
 * 4 sibling tabs (campaigns / coupons / tiers / points) share the same
 * AdminTabs strip so users can hop between them.
 */

const MARKETING_TABS = [
  { href: "/admin/campaigns", label: "行銷活動" },
  { href: "/admin/coupons", label: "優惠券" },
  { href: "/admin/marketing/tiers", label: "會員等級" },
  { href: "/admin/marketing/points", label: "點數規則" },
]

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const POINTS_SECTION_KEY = "points"

// ---------------------------------------------------------------------------
// Settings shape returned by GET /admin/settings (filtered to the points section)
// ---------------------------------------------------------------------------

interface FieldState {
  set: boolean
  value?: string | null
  preview?: string
}

interface Field {
  key: string
  secret: boolean
  state: FieldState
}

interface Section {
  key: string
  label: string
  fields: Field[]
}

interface SettingsResponse {
  sections: Section[]
}

// Local draft map: setting key -> draft value (undefined = untouched)
type Drafts = Record<string, string | undefined>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getServerValue(fields: Field[], key: string): string {
  const f = fields.find((x) => x.key === key)
  return (f?.state.value ?? "") as string
}

function currentValue(fields: Field[], drafts: Drafts, key: string): string {
  return drafts[key] !== undefined ? (drafts[key] as string) : getServerValue(fields, key)
}

// ---------------------------------------------------------------------------
// Stats fetched server-side (well, client-side here — same supabase auth flow
// the customers list uses) for the read-only card.
// ---------------------------------------------------------------------------

interface PointsStats {
  members_with_points: number
  total_outstanding: number
  expiring_total: number
  expiring_members: number
}

async function loadPointsStats(): Promise<PointsStats> {
  const supabase = createClient()

  // 1) v_user_points_balance — members with balance > 0 and sum of those
  //    balances.
  const { data: balances, error: balErr } = await supabase
    .from("v_user_points_balance")
    .select("user_id, balance")
    .gt("balance", 0)

  if (balErr) throw new Error(`載入餘額失敗：${balErr.message}`)

  const rows = (balances ?? []) as { user_id: string; balance: number }[]
  const members_with_points = rows.length
  const total_outstanding = rows.reduce((s, r) => s + Number(r.balance ?? 0), 0)

  // 2) Expiring within 30 days — earn rows with expires_at in [now, now+30d]
  //    that haven't already been matched by an expire row. Mirrors the public
  //    /points/balance logic in apps/api/src/routes/points.ts.
  const now = new Date()
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const { data: earnRows, error: earnErr } = await supabase
    .from("points_ledger")
    .select("id, user_id, delta")
    .eq("source", "earn")
    .not("expires_at", "is", null)
    .gte("expires_at", now.toISOString())
    .lte("expires_at", horizon.toISOString())

  if (earnErr) throw new Error(`載入即將過期點數失敗：${earnErr.message}`)

  const earns = (earnRows ?? []) as { id: string; user_id: string; delta: number }[]

  let expiringTotal = 0
  const usersExpiring = new Set<string>()

  if (earns.length > 0) {
    const earnIds = earns.map((r) => r.id)
    const { data: alreadyExpired } = await supabase
      .from("points_ledger")
      .select("source_ref_id")
      .eq("source", "expire")
      .in("source_ref_id", earnIds)

    const expiredSet = new Set<string>()
    for (const row of (alreadyExpired as { source_ref_id: string | null }[] | null) ?? []) {
      if (row.source_ref_id) expiredSet.add(row.source_ref_id)
    }

    for (const r of earns) {
      if (expiredSet.has(r.id)) continue
      const delta = Number(r.delta ?? 0)
      if (delta <= 0) continue
      expiringTotal += delta
      usersExpiring.add(r.user_id)
    }
  }

  return {
    members_with_points,
    total_outstanding,
    expiring_total: expiringTotal,
    expiring_members: usersExpiring.size,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminPointsRulesPage() {
  const [fields, setFields] = useState<Field[]>([])
  const [drafts, setDrafts] = useState<Drafts>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [stats, setStats] = useState<PointsStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/settings`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as SettingsResponse
      const section = data.sections.find((s) => s.key === POINTS_SECTION_KEY)
      setFields(section?.fields ?? [])
      setDrafts({})
    } catch (err) {
      console.error(err)
      toast.error("載入點數規則失敗")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      setStats(await loadPointsStats())
    } catch (err) {
      console.error(err)
      const msg = err instanceof Error ? err.message : "載入狀態失敗"
      toast.error(msg)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
    void loadStats()
  }, [loadSettings, loadStats])

  function setDraft(key: string, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }))
  }

  async function handleSave() {
    const dirty = Object.entries(drafts).filter(([, v]) => v !== undefined)
    if (dirty.length === 0) {
      toast.message("沒有變更")
      return
    }

    setSaving(true)
    try {
      const results = await Promise.all(
        dirty.map(async ([key, value]) => {
          const res = await adminFetch(`${API_URL}/admin/settings`, {
            method: "PUT",
            body: JSON.stringify({ key, value: value === "" ? null : value }),
          })
          if (!res.ok) {
            const detail = await res.text()
            throw new Error(`儲存 ${key} 失敗：${detail}`)
          }
          return key
        }),
      )
      toast.success(`已儲存（${results.length} 項）`)
      await loadSettings()
      void loadStats()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const dirtyCount = Object.values(drafts).filter((v) => v !== undefined).length

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-3 flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-[#10305a]" />
          <h1 className="text-xl font-semibold text-[#10305a]">行銷</h1>
        </div>
        <AdminTabs tabs={MARKETING_TABS} />
        <p className="text-sm text-zinc-500">
          公益點數規則由此熱更新，儲存後 30 秒內全站結帳生效，
          不需重新部署。
        </p>
      </header>

      {/* Card 1 — 點數規則 form (2 fields only: ratio + expire_days) */}
      <section className="rounded-[10px] border bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold text-[#10305a]">點數規則</h2>
          {dirtyCount > 0 && (
            <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {dirtyCount} 項待儲存
            </span>
          )}
        </div>

        {loading ? (
          <div className="px-5 py-8 text-sm text-zinc-500">載入中…</div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            {/* 換算: 1 點 = NT$ [points.ratio] */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-sm font-medium text-zinc-900">換算</Label>
                <p className="mt-0.5 text-xs text-zinc-500">
                  1 點折抵金額（單位：新台幣）
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-700">1 點 = NT$</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={currentValue(fields, drafts, "points.ratio")}
                  onChange={(e) => setDraft("points.ratio", e.target.value)}
                  className="w-28"
                />
              </div>
            </div>

            {/* 過期: [points.expire_days] 天 (0 = 永不過期) */}
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-sm font-medium text-zinc-900">過期</Label>
                <p className="mt-0.5 text-xs text-zinc-500">
                  點數自獲得日起算的有效天數（0 = 永不過期）
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={currentValue(fields, drafts, "points.expire_days")}
                  onChange={(e) => setDraft("points.expire_days", e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-zinc-700">天</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={dirtyCount === 0 || saving}
                className="bg-[#10305a] text-white hover:bg-[#10305a]/90"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? "儲存中…" : `儲存${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Card 2 — 目前狀態 read-only */}
      <section className="rounded-[10px] border bg-white shadow-sm">
        <div className="border-b px-5 py-4">
          <h2 className="text-base font-semibold text-[#10305a]">目前狀態</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            即時統計自 v_user_points_balance 與 points_ledger
          </p>
        </div>
        <div className="px-5 py-5">
          {statsLoading ? (
            <p className="text-sm text-zinc-500">載入中…</p>
          ) : !stats ? (
            <p className="text-sm text-zinc-500">無資料</p>
          ) : (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatRow
                label="有點數的會員"
                value={`${stats.members_with_points.toLocaleString()} 位`}
              />
              <StatRow
                label="流通中總點數"
                value={`${stats.total_outstanding.toLocaleString()} 點`}
              />
              <StatRow
                label="30 天內即將過期"
                value={`${stats.expiring_total.toLocaleString()} 點 / ${stats.expiring_members.toLocaleString()} 位會員`}
                highlight={stats.expiring_total > 0}
              />
            </dl>
          )}
        </div>
      </section>

      {/* Card 3 — 折抵預設行為 hint (hardcoded defaults documentation) */}
      <section className="rounded-[10px] border border-amber-200/60 bg-amber-50/40 px-5 py-4 text-sm text-[#687279]">
        <p className="font-medium text-[#10305a]">折抵預設行為（hardcode）</p>
        <ul className="ml-4 mt-2 list-disc space-y-0.5">
          <li>最少折抵：0 點起（不限）</li>
          <li>單筆上限：訂單金額 100%（可全額折抵）</li>
          <li>可與優惠券疊加：是</li>
          <li>可折抵運費：否</li>
          <li>可折抵特價商品：是</li>
        </ul>
        <p className="mt-2 text-xs">
          若特定活動需不同規則，至「行銷活動」tab 設定 campaign 內的覆蓋規則（功能尚未開放）。
        </p>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StatRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd
        className={`mt-1 text-lg font-semibold ${
          highlight ? "text-amber-600" : "text-[#10305a]"
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
