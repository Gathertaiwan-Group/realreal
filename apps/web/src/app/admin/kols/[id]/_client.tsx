"use client"

/**
 * KOL detail — client component.
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
 * (Section 6 — admin UI detail).
 *
 * 4-card layout:
 *   1. Hero          — avatar + name + slug + active toggle + copy-link
 *                      buttons for /k/<slug> and /?ref=<slug>.
 *   2. 編輯資料      — form with name / bio / avatar / socials /
 *                      commission_rate / coupon picker / is_active.
 *   3. 業績統計      — date-range picker + order count / revenue /
 *                      estimated commission. Re-fetches from the
 *                      `/admin/kols/:id/stats?from=&to=` endpoint when
 *                      the range changes.
 *   4. 最近訂單      — table of attributed orders (links to
 *                      /admin/orders/<id>).
 *
 * Mutations live in actions.ts; each runs inside startTransition with a
 * sonner toast and router.refresh() so the server re-fetches.
 */

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { toast } from "sonner"
import {
  Calendar,
  ChevronRight,
  Copy,
  ExternalLink,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { adminFetch } from "@/lib/admin-fetch"
import { CouponPicker } from "../CouponPicker"
import {
  deleteKolAction,
  updateKolAction,
  type KolUpdateInput,
} from "./actions"

// ---------------------------------------------------------------------------
// Types — mirror the API payload from admin-kols.ts GET /admin/kols/:id
// ---------------------------------------------------------------------------

export interface KolDetailData {
  id: string
  slug: string
  name: string
  avatar_url: string | null
  bio: string | null
  instagram_handle: string | null
  youtube_handle: string | null
  tiktok_handle: string | null
  coupon_id: string | null
  commission_rate: number | string
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at?: string
  coupon?: {
    id: string
    code: string
    type: string
    value: number | string
  } | null
  coupons?: {
    id: string
    code: string
    type: string
    value: number | string
  } | null
  stats?: {
    order_count: number
    total_revenue: number
    est_commission: number
    from?: string | null
    to?: string | null
  } | null
  recent_orders?: Array<{
    id: string
    order_number: string
    total: number | string
    status: string
    payment_status?: string | null
    created_at: string
    user_id?: string | null
    user?: { display_name?: string | null; email?: string | null } | null
  }>
}

interface StatsResponse {
  data?: KolDetailData["stats"]
  stats?: KolDetailData["stats"]
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNTD(n: number | string | null | undefined): string {
  return `NT$ ${Number(n ?? 0).toLocaleString()}`
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("zh-TW")
}

function getCoupon(d: KolDetailData) {
  return d.coupon ?? d.coupons ?? null
}

/** First day of the current month (YYYY-MM-DD). */
function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
}

/** Today (YYYY-MM-DD). */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function publicOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin
  }
  return "https://realreal.cc"
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function KolDetailClient({
  kolId,
  initialData,
}: {
  kolId: string
  initialData: KolDetailData
}) {
  const router = useRouter()
  return (
    <div className="space-y-6">
      <Link
        href="/admin/kols"
        className="inline-flex items-center text-sm text-zinc-400 hover:text-zinc-600"
      >
        <ChevronRight className="h-4 w-4 rotate-180" />
        聯盟行銷
      </Link>

      <HeroCard kolId={kolId} kol={initialData} onChange={() => router.refresh()} />

      <EditFormCard
        kolId={kolId}
        kol={initialData}
        onChange={() => router.refresh()}
      />

      <StatsCard kolId={kolId} initialStats={initialData.stats ?? null} />

      <RecentOrdersCard orders={initialData.recent_orders ?? []} />

      <DangerZoneCard
        kolId={kolId}
        name={initialData.name}
        onDeleted={() => router.push("/admin/kols")}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Hero card — avatar / name / copy-link / active toggle
// ---------------------------------------------------------------------------

function HeroCard({
  kolId,
  kol,
  onChange,
}: {
  kolId: string
  kol: KolDetailData
  onChange: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const origin = publicOrigin()
  const landingUrl = `${origin}/k/${kol.slug}`
  const refUrl = `${origin}/?ref=${kol.slug}`

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} 已複製`)
    } catch {
      toast.error("複製失敗，請手動複製")
    }
  }

  function handleToggleActive() {
    const next = !kol.is_active
    startTransition(async () => {
      try {
        await updateKolAction(kolId, { is_active: next })
        toast.success(next ? "KOL 已啟用" : "KOL 已停用")
        onChange()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新失敗")
      }
    })
  }

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            {kol.avatar_url ? (
              <Image
                src={kol.avatar_url}
                alt={kol.name}
                width={64}
                height={64}
                unoptimized
                className="h-16 w-16 rounded-full object-cover bg-zinc-100"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-zinc-200 flex items-center justify-center text-lg font-semibold text-zinc-500">
                {kol.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-semibold text-[#10305a] truncate">
                  {kol.name}
                </h1>
                <Badge
                  className={
                    kol.is_active
                      ? "bg-green-50 text-green-700 border border-green-200"
                      : "bg-zinc-100 text-zinc-500 border border-zinc-200"
                  }
                >
                  {kol.is_active ? "啟用中" : "停用"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[#687279]">
                <span className="font-mono">/k/{kol.slug}</span>
                <span className="mx-2 text-zinc-300">·</span>
                <span>佣金 {Number(kol.commission_rate)}%</span>
                <span className="mx-2 text-zinc-300">·</span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  加入 {formatDate(kol.created_at)}
                </span>
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
                {kol.instagram_handle && (
                  <a
                    href={`https://instagram.com/${kol.instagram_handle.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-[#10305a]"
                  >
                    <span className="font-semibold">IG</span>
                    {kol.instagram_handle}
                  </a>
                )}
                {kol.youtube_handle && (
                  <a
                    href={`https://youtube.com/${kol.youtube_handle.startsWith("@") ? "" : "@"}${kol.youtube_handle.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-[#10305a]"
                  >
                    <span className="font-semibold">YT</span>
                    {kol.youtube_handle}
                  </a>
                )}
                {kol.tiktok_handle && (
                  <a
                    href={`https://tiktok.com/@${kol.tiktok_handle.replace(/^@/, "")}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-[#10305a]"
                  >
                    <span className="font-semibold">TT</span>
                    {kol.tiktok_handle}
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            <Button
              size="sm"
              variant={kol.is_active ? "outline" : "default"}
              onClick={handleToggleActive}
              disabled={isPending}
            >
              {kol.is_active ? "停用 KOL" : "啟用 KOL"}
            </Button>
            <Link
              href={landingUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[#10305a] inline-flex items-center gap-1 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              預覽 landing 頁
            </Link>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          <CopyLink label="KOL landing 連結" url={landingUrl} onCopy={copy} />
          <CopyLink label="?ref 通用連結" url={refUrl} onCopy={copy} />
        </div>
      </CardContent>
    </Card>
  )
}

function CopyLink({
  label,
  url,
  onCopy,
}: {
  label: string
  url: string
  onCopy: (text: string, label: string) => void
}) {
  return (
    <div className="border rounded-lg p-3 bg-zinc-50">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-[#687279]">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => onCopy(url, label)}
        >
          <Copy className="h-3 w-3 mr-1" />
          複製
        </Button>
      </div>
      <code className="block text-xs font-mono text-[#10305a] truncate">{url}</code>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. Edit-form card
// ---------------------------------------------------------------------------

function EditFormCard({
  kolId,
  kol,
  onChange,
}: {
  kolId: string
  kol: KolDetailData
  onChange: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const input: KolUpdateInput = {
      slug: ((fd.get("slug") as string) || "").trim().toLowerCase(),
      name: ((fd.get("name") as string) || "").trim(),
      bio: ((fd.get("bio") as string) || "").trim() || null,
      avatar_url: ((fd.get("avatar_url") as string) || "").trim() || null,
      instagram_handle:
        ((fd.get("instagram_handle") as string) || "").trim() || null,
      youtube_handle:
        ((fd.get("youtube_handle") as string) || "").trim() || null,
      tiktok_handle: ((fd.get("tiktok_handle") as string) || "").trim() || null,
      coupon_id: ((fd.get("coupon_id") as string) || "").trim() || null,
      commission_rate: Number(fd.get("commission_rate")) || 0,
      is_active: fd.get("is_active") === "on",
      notes: ((fd.get("notes") as string) || "").trim() || null,
    }

    startTransition(async () => {
      try {
        await updateKolAction(kolId, input)
        toast.success("KOL 已更新")
        onChange()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新失敗")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-[#10305a]">編輯資料</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="f-slug" className="text-xs">
                Slug *
              </Label>
              <Input
                id="f-slug"
                name="slug"
                required
                pattern="[a-z0-9-]+"
                defaultValue={kol.slug}
                className="lowercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-name" className="text-xs">
                顯示名稱 *
              </Label>
              <Input id="f-name" name="name" required defaultValue={kol.name} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-avatar" className="text-xs">
                頭像 URL
              </Label>
              <Input
                id="f-avatar"
                name="avatar_url"
                type="url"
                defaultValue={kol.avatar_url ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-ig" className="text-xs">
                Instagram handle
              </Label>
              <Input
                id="f-ig"
                name="instagram_handle"
                defaultValue={kol.instagram_handle ?? ""}
                placeholder="@handle"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-yt" className="text-xs">
                YouTube handle
              </Label>
              <Input
                id="f-yt"
                name="youtube_handle"
                defaultValue={kol.youtube_handle ?? ""}
                placeholder="@handle"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-tt" className="text-xs">
                TikTok handle
              </Label>
              <Input
                id="f-tt"
                name="tiktok_handle"
                defaultValue={kol.tiktok_handle ?? ""}
                placeholder="@handle"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-rate" className="text-xs">
                佣金比例 (%)
              </Label>
              <Input
                id="f-rate"
                name="commission_rate"
                type="number"
                min={0}
                max={100}
                step={0.1}
                required
                defaultValue={Number(kol.commission_rate)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">綁定 coupon</Label>
              <CouponPicker name="coupon_id" defaultValue={kol.coupon_id ?? ""} />
            </div>
            <div className="sm:col-span-2 md:col-span-3 space-y-1.5">
              <Label htmlFor="f-bio" className="text-xs">
                簡介
              </Label>
              <textarea
                id="f-bio"
                name="bio"
                rows={2}
                defaultValue={kol.bio ?? ""}
                className={selectClass}
              />
            </div>
            <div className="sm:col-span-2 md:col-span-3 space-y-1.5">
              <Label htmlFor="f-notes" className="text-xs">
                內部備註（不對外）
              </Label>
              <textarea
                id="f-notes"
                name="notes"
                rows={2}
                defaultValue={kol.notes ?? ""}
                className={selectClass}
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked={kol.is_active}
                  className="rounded"
                />
                啟用
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "儲存中…" : "儲存變更"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 3. Stats card — date-range picker + numbers
// ---------------------------------------------------------------------------

function StatsCard({
  kolId,
  initialStats,
}: {
  kolId: string
  initialStats: KolDetailData["stats"]
}) {
  const [from, setFrom] = useState<string>(monthStart())
  const [to, setTo] = useState<string>(today())
  const [stats, setStats] = useState<KolDetailData["stats"]>(initialStats)
  const [loading, setLoading] = useState(false)

  const fetchRange = useCallback(
    async (rangeFrom: string, rangeTo: string) => {
      setLoading(true)
      try {
        const url = new URL(`${API_URL}/admin/kols/${kolId}/stats`)
        if (rangeFrom) url.searchParams.set("from", rangeFrom)
        if (rangeTo) url.searchParams.set("to", rangeTo)
        const res = await adminFetch(url.toString())
        if (res.ok) {
          const json: StatsResponse = await res.json()
          setStats(json.data ?? json.stats ?? null)
        } else {
          toast.error(`載入統計失敗 (${res.status})`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "載入統計失敗")
      } finally {
        setLoading(false)
      }
    },
    [kolId],
  )

  // Auto-load the current month on first render so the card reflects the
  // selected range even if the initial server payload only had lifetime numbers.
  useEffect(() => {
    fetchRange(from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const numbers = useMemo(
    () => ({
      orders: Number(stats?.order_count ?? 0),
      revenue: Number(stats?.total_revenue ?? 0),
      commission: Number(stats?.est_commission ?? 0),
    }),
    [stats],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-[#10305a]">業績統計</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1.5">
            <Label htmlFor="stats-from" className="text-xs">
              起
            </Label>
            <Input
              id="stats-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stats-to" className="text-xs">
              迄
            </Label>
            <Input
              id="stats-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9"
            />
          </div>
          <Button
            size="sm"
            onClick={() => fetchRange(from, to)}
            disabled={loading}
          >
            {loading ? "查詢中…" : "查詢"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const f = monthStart()
              const t = today()
              setFrom(f)
              setTo(t)
              fetchRange(f, t)
            }}
            disabled={loading}
          >
            本月
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatTile label="訂單數" value={numbers.orders.toLocaleString()} />
          <StatTile
            label="業績"
            value={formatNTD(numbers.revenue)}
            valueClass="text-[#10305a]"
          />
          <StatTile
            label="估算佣金"
            value={formatNTD(numbers.commission)}
            valueClass="text-amber-700"
          />
        </div>
      </CardContent>
    </Card>
  )
}

function StatTile({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="border rounded-lg bg-white p-4">
      <p className="text-xs text-[#687279]">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          valueClass ?? "text-[#10305a]"
        }`}
      >
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Recent orders card
// ---------------------------------------------------------------------------

function RecentOrdersCard({
  orders,
}: {
  orders: NonNullable<KolDetailData["recent_orders"]>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-[#10305a]">
          最近 attributed 訂單
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-[#10305a] text-xs">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">訂單編號</th>
              <th className="px-4 py-2.5 text-left font-medium">顧客</th>
              <th className="px-4 py-2.5 text-left font-medium">日期</th>
              <th className="px-4 py-2.5 text-left font-medium">狀態</th>
              <th className="px-4 py-2.5 text-right font-medium">金額</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                  尚無透過此 KOL 帶來的訂單。
                </td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="hover:bg-[#fffeee]/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="text-[#10305a] hover:underline font-mono text-xs"
                    >
                      {o.order_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#687279] text-xs">
                    {o.user?.display_name ?? o.user?.email ?? o.user_id ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[#687279] text-xs">
                    {formatDate(o.created_at)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <Badge variant="outline">{o.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-[#10305a]">
                    {formatNTD(o.total)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 5. Danger zone — delete KOL
// ---------------------------------------------------------------------------

function DangerZoneCard({
  kolId,
  name,
  onDeleted,
}: {
  kolId: string
  name: string
  onDeleted: () => void
}) {
  const [isPending, startTransition] = useTransition()
  function handleDelete() {
    if (
      !confirm(
        `確定要刪除 KOL「${name}」嗎？\n若有歷史訂單，預設改為停用以保留 audit trail。`,
      )
    )
      return
    startTransition(async () => {
      try {
        await deleteKolAction(kolId)
        toast.success(`KOL「${name}」已刪除`)
        onDeleted()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "刪除失敗")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-red-700">危險區</CardTitle>
      </CardHeader>
      <CardContent>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleDelete}
          disabled={isPending}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          {isPending ? "刪除中…" : "刪除 KOL"}
        </Button>
        <p className="mt-2 text-xs text-zinc-500">
          有歷史訂單時 API 會自動改為 soft-delete (停用)。
        </p>
      </CardContent>
    </Card>
  )
}
