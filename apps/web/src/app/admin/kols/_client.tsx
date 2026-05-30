"use client"

/**
 * KOL list — client component.
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
 * (Section 6 — admin UI list).
 *
 * Renders:
 *   • inline "新增 KOL" form (toggleable, posts to createKolAction).
 *   • summary table: avatar / name / slug / coupon / commission % /
 *     order count / revenue / est. commission / active toggle.
 *
 * Row click navigates to /admin/kols/<id>. The active toggle uses
 * updateKolAction so it can be flipped without leaving the list.
 */

import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"
import { Plus, Share2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CouponPicker } from "./CouponPicker"
import {
  createKolAction,
  getKolConversionAction,
  updateKolAction,
} from "./[id]/actions"

export interface KolListRow {
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
  created_at: string
  coupon?: { id: string; code: string; value: number | string; type: string } | null
  coupons?: { id: string; code: string; value: number | string; type: string } | null
  order_count?: number | string | null
  total_revenue?: number | string | null
  est_commission?: number | string | null
}

interface Props {
  kols: KolListRow[]
  loadError: string | null
}

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

function formatNTD(n: number | string | null | undefined): string {
  return `NT$ ${Number(n ?? 0).toLocaleString()}`
}

function formatCommissionPct(n: number | string | null | undefined): string {
  return `${Number(n ?? 0)}%`
}

function getCoupon(row: KolListRow): { code: string } | null {
  return row.coupon ?? row.coupons ?? null
}

interface ConversionCell {
  status: "loading" | "ok" | "error"
  rate?: number
  clicks?: number
}

/**
 * Color rule per spec K:
 *   • > 2%        → green (good)
 *   • 0–2%        → gray  (neutral)
 *   • 0 with clicks > 0 → red (had traffic, zero orders)
 */
function conversionClass(cell: ConversionCell | undefined): string {
  if (!cell || cell.status !== "ok" || cell.rate == null) {
    return "text-zinc-300"
  }
  if (cell.rate > 2) return "text-green-600"
  if (cell.rate === 0 && (cell.clicks ?? 0) > 0) return "text-red-600"
  return "text-zinc-500"
}

function formatConversionPct(rate: number): string {
  return `${rate.toFixed(2)}%`
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

export function KolsListClient({ kols, loadError }: Props) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [conversions, setConversions] = useState<Record<string, ConversionCell>>(
    {},
  )

  // Per spec K: list page shows 7 日 default; N+1 acceptable while KOL count < 20.
  useEffect(() => {
    if (kols.length === 0) return
    let cancelled = false

    const from = isoDaysAgo(7)
    const to = new Date().toISOString()

    // Seed each row as loading so the cells render a placeholder immediately.
    setConversions((prev) => {
      const next = { ...prev }
      for (const k of kols) next[k.id] = { status: "loading" }
      return next
    })

    void Promise.all(
      kols.map(async (k) => {
        try {
          const r = await getKolConversionAction(k.id, from, to)
          return [
            k.id,
            {
              status: "ok" as const,
              rate: Number(r?.conversion_rate ?? 0),
              clicks: Number(r?.clicks ?? 0),
            },
          ] as const
        } catch {
          return [k.id, { status: "error" as const }] as const
        }
      }),
    ).then((entries) => {
      if (cancelled) return
      setConversions((prev) => {
        const next = { ...prev }
        for (const [id, cell] of entries) next[id] = cell
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [kols])

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)

    startTransition(async () => {
      try {
        const created = await createKolAction({
          slug: ((fd.get("slug") as string) || "").trim().toLowerCase(),
          name: ((fd.get("name") as string) || "").trim(),
          bio: ((fd.get("bio") as string) || "").trim() || null,
          avatar_url: ((fd.get("avatar_url") as string) || "").trim() || null,
          instagram_handle:
            ((fd.get("instagram_handle") as string) || "").trim() || null,
          youtube_handle:
            ((fd.get("youtube_handle") as string) || "").trim() || null,
          tiktok_handle:
            ((fd.get("tiktok_handle") as string) || "").trim() || null,
          coupon_id: ((fd.get("coupon_id") as string) || "").trim() || null,
          commission_rate: Number(fd.get("commission_rate")) || 0,
          is_active: fd.get("is_active") === "on",
        })
        toast.success(`KOL「${created?.name ?? fd.get("name")}」已建立`)
        form.reset()
        setShowCreate(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "建立失敗")
      }
    })
  }

  function handleToggleActive(row: KolListRow, next: boolean) {
    startTransition(async () => {
      try {
        await updateKolAction(row.id, { is_active: next })
        toast.success(next ? `「${row.name}」已啟用` : `「${row.name}」已停用`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新失敗")
      }
    })
  }

  const activeCount = kols.filter((k) => k.is_active).length
  const totalRevenue = kols.reduce(
    (sum, k) => sum + Number(k.total_revenue ?? 0),
    0,
  )
  const totalCommission = kols.reduce(
    (sum, k) => sum + Number(k.est_commission ?? 0),
    0,
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[#10305a] flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            聯盟行銷 / KOL
          </h1>
          <p className="mt-1 text-sm text-[#687279]">
            管理合作 KOL 的專屬連結、折扣 coupon 與佣金比例。
          </p>
        </div>
        {!showCreate && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1" />
            新增 KOL
          </Button>
        )}
      </div>

      {loadError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          載入 KOL 列表失敗：{loadError}。請確認 API 是否上線。
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="border rounded-lg bg-white p-4 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#10305a]">新增 KOL</h3>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="text-zinc-400 hover:text-zinc-600"
              aria-label="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-slug" className="text-xs">
                Slug *
                <span className="ml-1 text-[10px] text-zinc-400">
                  (a-z, 0-9, -)
                </span>
              </Label>
              <Input
                id="new-slug"
                name="slug"
                required
                pattern="[a-z0-9-]+"
                placeholder="例如 jenny-lee"
                className="lowercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-name" className="text-xs">
                顯示名稱 *
              </Label>
              <Input id="new-name" name="name" required placeholder="Jenny Lee" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-avatar" className="text-xs">
                頭像 URL
              </Label>
              <Input
                id="new-avatar"
                name="avatar_url"
                type="url"
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-ig" className="text-xs">
                Instagram handle
              </Label>
              <Input id="new-ig" name="instagram_handle" placeholder="@jennylee" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-yt" className="text-xs">
                YouTube handle
              </Label>
              <Input id="new-yt" name="youtube_handle" placeholder="@jennylee" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-tt" className="text-xs">
                TikTok handle
              </Label>
              <Input id="new-tt" name="tiktok_handle" placeholder="@jennylee" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-rate" className="text-xs">
                佣金比例 (%)
              </Label>
              <Input
                id="new-rate"
                name="commission_rate"
                type="number"
                min={0}
                max={100}
                step={0.1}
                defaultValue={10}
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">綁定 coupon</Label>
              <CouponPicker name="coupon_id" />
            </div>
            <div className="sm:col-span-2 md:col-span-3 space-y-1.5">
              <Label htmlFor="new-bio" className="text-xs">
                簡介
              </Label>
              <textarea
                id="new-bio"
                name="bio"
                rows={2}
                placeholder="健身網紅、營養師…"
                className={selectClass}
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="is_active"
                  defaultChecked
                  className="rounded"
                />
                立即啟用
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "建立中…" : "建立 KOL"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowCreate(false)}
              disabled={isPending}
            >
              取消
            </Button>
          </div>
        </form>
      )}

      {/* Summary */}
      {kols.length > 0 && (
        <div className="flex gap-4 text-sm text-zinc-500 flex-wrap">
          <span>共 {kols.length} 位</span>
          <span>啟用 {activeCount} 位</span>
          <span>本期業績 {formatNTD(totalRevenue)}</span>
          <span>本期估算佣金 {formatNTD(totalCommission)}</span>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-[#10305a] text-xs">
            <tr>
              <th className="px-4 py-3 text-left font-medium">KOL</th>
              <th className="px-4 py-3 text-left font-medium">Slug</th>
              <th className="px-4 py-3 text-left font-medium">Coupon</th>
              <th className="px-4 py-3 text-right font-medium">佣金 %</th>
              <th
                className="px-4 py-3 text-right font-medium"
                title="近 7 日點擊 → 訂單轉換率"
              >
                7 日轉換率
              </th>
              <th className="px-4 py-3 text-right font-medium">訂單數</th>
              <th className="px-4 py-3 text-right font-medium">業績</th>
              <th className="px-4 py-3 text-right font-medium">估算佣金</th>
              <th className="px-4 py-3 text-center font-medium">啟用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {kols.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-12 text-center text-zinc-400"
                >
                  尚無 KOL — 點擊上方「新增 KOL」開始。
                </td>
              </tr>
            ) : (
              kols.map((kol) => {
                const coupon = getCoupon(kol)
                return (
                  <tr
                    key={kol.id}
                    className="cursor-pointer hover:bg-[#fffeee]/50"
                    onClick={() => router.push(`/admin/kols/${kol.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {kol.avatar_url ? (
                          <Image
                            src={kol.avatar_url}
                            alt={kol.name}
                            width={32}
                            height={32}
                            className="h-8 w-8 rounded-full object-cover bg-zinc-100"
                            unoptimized
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-zinc-200 flex items-center justify-center text-xs font-semibold text-zinc-500">
                            {kol.name.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-[#10305a] truncate">
                            {kol.name}
                          </p>
                          {kol.bio && (
                            <p className="text-xs text-zinc-400 truncate max-w-[16rem]">
                              {kol.bio}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/k/${kol.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs text-[#10305a] hover:underline"
                      >
                        /k/{kol.slug}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {coupon ? (
                        <code className="bg-zinc-100 px-1.5 py-0.5 rounded font-bold">
                          {coupon.code}
                        </code>
                      ) : (
                        <span className="text-zinc-400">未綁定</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCommissionPct(kol.commission_rate)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right tabular-nums font-medium ${conversionClass(
                        conversions[kol.id],
                      )}`}
                    >
                      {(() => {
                        const cell = conversions[kol.id]
                        if (!cell || cell.status === "loading") return "…"
                        if (cell.status === "error") return "—"
                        return formatConversionPct(cell.rate ?? 0)
                      })()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {Number(kol.order_count ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-[#10305a]">
                      {formatNTD(kol.total_revenue)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-amber-700">
                      {formatNTD(kol.est_commission)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleActive(kol, !kol.is_active)
                        }}
                        disabled={isPending}
                        className="inline-flex"
                        aria-label={kol.is_active ? "停用" : "啟用"}
                      >
                        <Badge
                          className={
                            kol.is_active
                              ? "bg-green-50 text-green-700 border border-green-200"
                              : "bg-zinc-100 text-zinc-500 border border-zinc-200"
                          }
                        >
                          {kol.is_active ? "啟用中" : "停用"}
                        </Badge>
                      </button>
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
