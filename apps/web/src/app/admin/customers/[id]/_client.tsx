"use client"

/**
 * Customer detail page client — 5-card layout per spec Section 4.
 *
 *   1. Hero            — name + email/phone/joined + role badge + 操作 buttons
 *   2. 會員狀態         — tier badge, total spend, progress to next tier, points
 *   3. 最近消費         — 10 latest orders table
 *   4. 點數紀錄         — 50 latest ledger rows
 *   5. Admin 操作       — manual adjust / change tier / reset email / disable
 *
 * Mutations live in actions.ts. Each runs inside startTransition and pops
 * a sonner toast; the server action revalidates the path so the table /
 * balance / tier badge refresh after success.
 */

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  Mail,
  Phone,
  Calendar,
  Coins,
  Plus,
  Minus,
  Edit,
  KeyRound,
  Ban,
  ShieldCheck,
  ChevronRight,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { getOrderDisplayStatus } from "@/lib/order-display-status"
import {
  adjustPointsAction,
  changeTierAction,
  disableAccountAction,
  editProfileAction,
  sendResetEmailAction,
} from "./actions"

// ---------------------------------------------------------------------------
// Types — mirror the API payload from
// apps/api/src/routes/admin-customers.ts GET /admin/customers/:id
// ---------------------------------------------------------------------------

export interface CustomerDetailData {
  profile: {
    user_id: string
    display_name: string | null
    phone: string | null
    birthday: string | null
    role: string | null
    created_at: string
    total_spend: number
    membership_tier_id: string | null
    tier_started_at: string | null
    tier_expires_at: string | null
    tier_period_spend: number
    email: string | null
    last_sign_in_at: string | null
  }
  tier: {
    id: string
    name: string
    min_spend: number | string
    rebate_rate: number | string
    benefits: Record<string, unknown> | null
    discount_rate: number | string
    sort_order: number
    requalify_amount: number | string | null
    requalify_window_months: number | null
    validity_months: number | null
  } | null
  points: {
    balance: number
    expiring_soon: number
  }
  orders: Array<{
    id: string
    order_number: string
    total: number | string
    status: string
    payment_status: string
    points_used: number | null
    created_at: string
  }>
  ledger: Array<{
    id: string
    delta: number
    source: string
    source_ref_id: string | null
    note: string | null
    expires_at: string | null
    actor_id: string | null
    created_at: string
  }>
  next_tier: {
    id: string
    name: string
    min_spend: number | string
    rebate_rate: number | string
  } | null
}

interface TierRow {
  id: string
  name: string
  min_spend: number | string
  rebate_rate: number | string
  sort_order: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<string, string> = {
  earn: "消費回饋",
  redeem: "折抵消費",
  expire: "過期",
  refund: "退款返還",
  manual_adjust: "手動調整",
  promo: "活動贈點",
}

/** Tier badge colour by sort_order (lowest → highest). */
function tierBadgeClass(sortOrder: number | undefined): string {
  switch (sortOrder) {
    case 0:
      return "bg-gray-100 text-gray-700 border-gray-200"
    case 1:
      return "bg-blue-50 text-blue-700 border-blue-200"
    case 2:
      return "bg-amber-50 text-amber-700 border-amber-200"
    case 3:
      return "bg-purple-50 text-purple-700 border-purple-200"
    default:
      return "bg-[#10305a]/10 text-[#10305a] border-[#10305a]/20"
  }
}

function formatNTD(n: number | string | null | undefined): string {
  return `NT$ ${Number(n ?? 0).toLocaleString()}`
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("zh-TW")
}

/** Format ISO date as YYYY/MM/DD (zero-padded). */
function formatDateSlash(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}/${m}/${day}`
}

/** Days from now until ISO date (rounded down, never negative). */
function daysUntil(iso: string): number {
  const target = new Date(iso).getTime()
  const now = Date.now()
  return Math.max(0, Math.floor((target - now) / (24 * 60 * 60 * 1000)))
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("zh-TW")
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function CustomerDetailClient({
  customerId,
  data,
  tiers,
}: {
  customerId: string
  data: CustomerDetailData
  tiers: TierRow[]
}) {
  const { profile, tier, points, orders, ledger, next_tier } = data
  const isDisabled = profile.role === "disabled"

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/admin/customers"
        className="inline-flex items-center text-sm text-zinc-400 hover:text-zinc-600"
      >
        <ChevronRight className="h-4 w-4 rotate-180" />
        客戶列表
      </Link>

      <HeroCard
        customerId={customerId}
        profile={profile}
        isDisabled={isDisabled}
        tiers={tiers}
        currentTierId={profile.membership_tier_id}
      />

      <MemberStatusCard
        tier={tier}
        totalSpend={profile.total_spend}
        points={points}
        nextTier={next_tier}
        tierStartedAt={profile.tier_started_at}
        tierExpiresAt={profile.tier_expires_at}
        tierPeriodSpend={profile.tier_period_spend}
      />

      <RecentOrdersCard customerId={profile.user_id} orders={orders} />

      <LedgerCard ledger={ledger} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Hero card
// ---------------------------------------------------------------------------

function HeroCard({
  customerId,
  profile,
  isDisabled,
  tiers,
  currentTierId,
}: {
  customerId: string
  profile: CustomerDetailData["profile"]
  isDisabled: boolean
  tiers: TierRow[]
  currentTierId: string | null
}) {
  const [showEditModal, setShowEditModal] = useState(false)

  const roleLabel: Record<string, string> = {
    admin: "管理員",
    editor: "編輯",
    viewer: "檢視",
    customer: "顧客",
    disabled: "已停用",
  }
  const roleBadgeClass =
    profile.role === "admin"
      ? "bg-[#10305a] text-white"
      : profile.role === "editor"
        ? "bg-[#10305a]/70 text-white"
        : profile.role === "disabled"
          ? "bg-red-100 text-red-700 border border-red-200"
          : "bg-gray-100 text-[#687279]"

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-[#10305a] truncate">
                {profile.display_name ?? "未命名客戶"}
              </h1>
              <Badge className={roleBadgeClass}>
                {roleLabel[profile.role ?? "customer"] ?? profile.role ?? "—"}
              </Badge>
              {isDisabled && (
                <Badge className="bg-red-50 text-red-700 border border-red-200">
                  帳號已停用
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm text-[#687279]">
              <div className="flex items-center gap-1.5 min-w-0">
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{profile.email ?? "—"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span>{profile.phone ?? "—"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span>加入於 {formatDate(profile.created_at)}</span>
              </div>
            </div>
            {profile.last_sign_in_at && (
              <p className="mt-1 text-xs text-zinc-400">
                上次登入：{formatDateTime(profile.last_sign_in_at)}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowEditModal(true)}
            >
              <Edit className="mr-1 h-3.5 w-3.5" />
              編輯資料
            </Button>
          </div>
        </div>
      </CardContent>
      {showEditModal && (
        <CustomerAdminModal
          customerId={customerId}
          initial={{
            display_name: profile.display_name,
            phone: profile.phone,
            birthday: profile.birthday,
          }}
          isDisabled={isDisabled}
          tiers={tiers}
          currentTierId={currentTierId}
          onClose={() => setShowEditModal(false)}
        />
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 2. 會員狀態 card
// ---------------------------------------------------------------------------

function MemberStatusCard({
  tier,
  totalSpend,
  points,
  nextTier,
  tierStartedAt,
  tierExpiresAt,
  tierPeriodSpend,
}: {
  tier: CustomerDetailData["tier"]
  totalSpend: number
  points: CustomerDetailData["points"]
  nextTier: CustomerDetailData["next_tier"]
  tierStartedAt: string | null
  tierExpiresAt: string | null
  tierPeriodSpend: number
}) {
  // Progress bar — 0 when no current tier (treat min_spend as 0), full when at top.
  const currentMin = Number(tier?.min_spend ?? 0)
  const nextMin = nextTier ? Number(nextTier.min_spend) : null
  let progressPct = 100
  let remainingLabel: string | null = null
  if (nextMin !== null && nextMin > currentMin) {
    const range = nextMin - currentMin
    const filled = Math.max(0, totalSpend - currentMin)
    progressPct = Math.min(100, Math.round((filled / range) * 100))
    const remaining = Math.max(0, nextMin - totalSpend)
    remainingLabel = `還差 ${formatNTD(remaining)} 升「${nextTier!.name}」`
  }

  const balanceDisplay = Math.max(0, points.balance)

  // Tier validity rows (spec C Section 6)
  const requalifyAmount = Number(tier?.requalify_amount ?? 0)
  const hasExpiry = tierExpiresAt !== null
  const daysLeft = hasExpiry ? daysUntil(tierExpiresAt!) : null
  const daysLeftColor =
    daysLeft === null
      ? "text-[#687279]"
      : daysLeft < 30
        ? "text-red-600"
        : daysLeft < 90
          ? "text-amber-600"
          : "text-[#687279]"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-[#10305a]">會員狀態</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Tier */}
          <div>
            <p className="text-xs text-[#687279] mb-1.5">目前等級</p>
            {tier ? (
              <Badge
                className={`text-sm px-3 py-1 border ${tierBadgeClass(tier.sort_order)}`}
              >
                {tier.name}
              </Badge>
            ) : (
              <span className="text-sm text-zinc-400">未指派</span>
            )}
            {tier && (
              <p className="mt-2 text-xs text-[#687279]">
                點數回饋 {Number(tier.rebate_rate)}%
              </p>
            )}
            {tier && (
              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-[#687279]">升等日</dt>
                  <dd className="text-[#10305a]">
                    {formatDateSlash(tierStartedAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[#687279]">期滿日</dt>
                  <dd className="text-[#10305a]">
                    {hasExpiry ? formatDateSlash(tierExpiresAt) : "永久"}
                  </dd>
                </div>
                {hasExpiry && (
                  <>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#687279]">本期累積</dt>
                      <dd className="text-[#10305a]">
                        {formatNTD(tierPeriodSpend)} /{" "}
                        {formatNTD(requalifyAmount)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-[#687279]">距期滿</dt>
                      <dd className={daysLeftColor}>{daysLeft} 天</dd>
                    </div>
                  </>
                )}
              </dl>
            )}
          </div>

          {/* Spend */}
          <div>
            <p className="text-xs text-[#687279] mb-1.5">累計消費</p>
            <p className="text-xl font-semibold text-[#10305a]">
              {formatNTD(totalSpend)}
            </p>
          </div>

          {/* Points balance */}
          <div>
            <p className="text-xs text-[#687279] mb-1.5">公益點數</p>
            <p className="text-xl font-semibold text-[#10305a] flex items-center gap-1">
              <Coins className="h-4 w-4 text-amber-500" />
              {balanceDisplay.toLocaleString()} 點
            </p>
            {points.expiring_soon > 0 && (
              <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                <span>🟡</span>
                30 天內過期 {points.expiring_soon.toLocaleString()} 點
              </p>
            )}
          </div>
        </div>

        {/* Tier progress */}
        <div>
          {remainingLabel ? (
            <>
              <div className="flex items-center justify-between text-xs text-[#687279] mb-1.5">
                <span>{tier?.name ?? "目前等級"}</span>
                <span>{nextTier!.name}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <p className="mt-1.5 text-xs text-[#10305a]">{remainingLabel}</p>
            </>
          ) : (
            <p className="text-xs text-green-700 flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              已達最高等級 ✓
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// 3. 最近消費 card
// ---------------------------------------------------------------------------

function RecentOrdersCard({
  customerId,
  orders,
}: {
  customerId: string
  orders: CustomerDetailData["orders"]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-[#10305a]">最近消費</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-[#10305a] text-xs">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">訂單編號</th>
              <th className="px-4 py-2.5 text-left font-medium">日期</th>
              <th className="px-4 py-2.5 text-right font-medium">金額</th>
              <th className="px-4 py-2.5 text-left font-medium">狀態</th>
              <th className="px-4 py-2.5 text-right font-medium">點數 +/-</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                  尚無消費紀錄
                </td>
              </tr>
            ) : (
              orders.map((o) => {
                const display = getOrderDisplayStatus({ status: o.status }, null)
                const pointsUsed = Number(o.points_used ?? 0)
                return (
                  <tr key={o.id} className="hover:bg-[#fffeee]/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="text-[#10305a] hover:underline font-mono text-xs"
                      >
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[#687279]">
                      {formatDate(o.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-[#10305a]">
                      {formatNTD(o.total)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={statusBadgeColor(display.color)}>
                        {display.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      {pointsUsed > 0 ? (
                        <span className="text-red-600">-{pointsUsed}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </CardContent>
      {orders.length > 0 && (
        <div className="border-t px-4 py-3 text-right">
          <Link
            href={`/admin/orders?user=${customerId}`}
            className="text-sm text-[#10305a] hover:underline"
          >
            看全部訂單 →
          </Link>
        </div>
      )}
    </Card>
  )
}

function statusBadgeColor(color: "gray" | "blue" | "amber" | "green" | "red"): string {
  switch (color) {
    case "gray":
      return "bg-gray-100 text-gray-700 border border-gray-200"
    case "blue":
      return "bg-blue-50 text-blue-700 border border-blue-200"
    case "amber":
      return "bg-amber-50 text-amber-700 border border-amber-200"
    case "green":
      return "bg-green-50 text-green-700 border border-green-200"
    case "red":
      return "bg-red-50 text-red-700 border border-red-200"
  }
}

// ---------------------------------------------------------------------------
// 4. 點數紀錄 card  (paginate 50 per page — local pagination over the
//    fetched 50, since the API returns at most 50 rows already; later
//    pages would require a query-param to the API but per spec the
//    initial slice is 50 — present as a single page and link to
//    extended view later.)
// ---------------------------------------------------------------------------

function LedgerCard({ ledger }: { ledger: CustomerDetailData["ledger"] }) {
  const [page, setPage] = useState(0)
  const pageSize = 50
  const pageRows = ledger.slice(page * pageSize, (page + 1) * pageSize)
  const totalPages = Math.max(1, Math.ceil(ledger.length / pageSize))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-[#10305a]">點數紀錄</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-[#10305a]/5 text-[#10305a] text-xs">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">時間</th>
              <th className="px-4 py-2.5 text-right font-medium">變動</th>
              <th className="px-4 py-2.5 text-left font-medium">來源</th>
              <th className="px-4 py-2.5 text-left font-medium">備註</th>
              <th className="px-4 py-2.5 text-left font-medium">過期日</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                  尚無點數紀錄
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const isPositive = row.delta > 0
                return (
                  <tr key={row.id} className="hover:bg-[#fffeee]/50">
                    <td className="px-4 py-3 text-xs text-[#687279]">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-medium ${
                        isPositive ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {isPositive ? "+" : ""}
                      {row.delta.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-[#10305a]">
                      {SOURCE_LABEL[row.source] ?? row.source}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#687279] max-w-xs truncate">
                      {row.note ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#687279]">
                      {row.source === "earn" ? formatDate(row.expires_at) : "—"}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </CardContent>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-3 text-xs">
          <span className="text-[#687279]">
            第 {page + 1} / {totalPages} 頁
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              上一頁
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              下一頁
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Customer admin modal — 合併「編輯資料」+「Admin 操作」
// ---------------------------------------------------------------------------
//
// 3 sections in one modal:
//   1. 基本資料      — 姓名 / 電話 / 生日  (batch save)
//   2. 會員操作      — 更換等級 (dropdown, 立即套用) + 手動加扣點 (inline form)
//   3. 帳號管理      — 發送密碼重設信 (fire-and-forget) + 停用/恢復 (2-step confirm)

function CustomerAdminModal({
  customerId,
  initial,
  isDisabled,
  tiers,
  currentTierId,
  onClose,
}: {
  customerId: string
  initial: {
    display_name: string | null
    phone: string | null
    birthday: string | null
  }
  isDisabled: boolean
  tiers: TierRow[]
  currentTierId: string | null
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()

  // Section 1 — 基本資料
  const [displayName, setDisplayName] = useState(initial.display_name ?? "")
  const [phone, setPhone] = useState(initial.phone ?? "")
  const [birthday, setBirthday] = useState(initial.birthday ?? "")

  // Section 2a — 等級
  const [selectedTier, setSelectedTier] = useState<string>(currentTierId ?? "")

  // Section 2b — 加扣點
  const [delta, setDelta] = useState<string>("")
  const [note, setNote] = useState<string>("")

  // Section 3 — 停用 confirm
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)

  function handleSaveProfile() {
    startTransition(async () => {
      try {
        await editProfileAction(customerId, {
          display_name: displayName.trim(),
          phone: phone.trim(),
          birthday: birthday.trim(),
        })
        toast.success("基本資料已更新")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "更新失敗")
      }
    })
  }

  function handleTierChange(newTierId: string) {
    if (!newTierId || newTierId === currentTierId) return
    startTransition(async () => {
      try {
        await changeTierAction(customerId, newTierId)
        toast.success("會員等級已更新")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "更新等級失敗")
        setSelectedTier(currentTierId ?? "")
      }
    })
  }

  function handleAdjustPoints() {
    const n = Number(delta)
    if (!Number.isInteger(n) || n === 0) {
      toast.error("請輸入非零整數")
      return
    }
    const trimmed = note.trim()
    if (!trimmed) {
      toast.error("請填寫原因")
      return
    }
    startTransition(async () => {
      try {
        await adjustPointsAction(customerId, n, trimmed)
        toast.success(`已${n > 0 ? "加" : "扣"} ${Math.abs(n)} 點`)
        setDelta("")
        setNote("")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "調整失敗")
      }
    })
  }

  function handleSendReset() {
    startTransition(async () => {
      try {
        const res = await sendResetEmailAction(customerId)
        toast.success(res.message ?? "已寄出密碼重設信")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "寄送失敗")
      }
    })
  }

  function handleDisableConfirm() {
    startTransition(async () => {
      try {
        const res = await disableAccountAction(customerId, !isDisabled)
        toast.success(res.role === "disabled" ? "帳號已停用" : "帳號已恢復")
        setShowDisableConfirm(false)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "操作失敗")
      }
    })
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-admin-title"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isPending) onClose()
        }}
      >
        <div className="w-full max-w-lg rounded-lg bg-white shadow-lg max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3">
            <h2 id="customer-admin-title" className="text-sm font-semibold text-[#10305a]">
              客戶管理
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="關閉"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Section 1 — 基本資料 */}
          <section className="p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#687279]">
              基本資料
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="edit-name" className="block text-xs text-[#687279] mb-1.5">
                  姓名
                </label>
                <input
                  id="edit-name"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={isPending}
                  className="w-full h-9 rounded-[10px] border border-[#10305a]/30 bg-white px-2 text-sm focus:border-[#10305a] focus:outline-none focus:ring-1 focus:ring-[#10305a]/30"
                />
              </div>
              <div>
                <label htmlFor="edit-phone" className="block text-xs text-[#687279] mb-1.5">
                  電話
                </label>
                <input
                  id="edit-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={isPending}
                  placeholder="0912345678"
                  className="w-full h-9 rounded-[10px] border border-[#10305a]/30 bg-white px-2 text-sm focus:border-[#10305a] focus:outline-none focus:ring-1 focus:ring-[#10305a]/30"
                />
              </div>
              <div>
                <label htmlFor="edit-birthday" className="block text-xs text-[#687279] mb-1.5">
                  生日
                </label>
                <input
                  id="edit-birthday"
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  disabled={isPending}
                  className="w-full h-9 rounded-[10px] border border-[#10305a]/30 bg-white px-2 text-sm focus:border-[#10305a] focus:outline-none focus:ring-1 focus:ring-[#10305a]/30"
                />
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSaveProfile} disabled={isPending}>
                  {isPending ? "儲存中…" : "儲存基本資料"}
                </Button>
              </div>
            </div>
          </section>

          {/* Section 2 — 會員操作 */}
          <section className="border-t p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#687279]">
              會員操作
            </h3>

            {/* 2a — tier */}
            <div className="mb-4">
              <label htmlFor="tier-select" className="block text-xs text-[#687279] mb-1.5">
                更換等級（立即套用）
              </label>
              <select
                id="tier-select"
                value={selectedTier}
                disabled={isPending || tiers.length === 0}
                onChange={(e) => {
                  setSelectedTier(e.target.value)
                  handleTierChange(e.target.value)
                }}
                className="w-full h-9 rounded-[10px] border border-[#10305a]/30 bg-white px-2 text-sm focus:border-[#10305a] focus:outline-none focus:ring-1 focus:ring-[#10305a]/30"
              >
                <option value="" disabled>
                  選擇等級…
                </option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} (門檻 {formatNTD(t.min_spend)} / 回饋 {Number(t.rebate_rate)}%)
                  </option>
                ))}
              </select>
            </div>

            {/* 2b — points adjust */}
            <div>
              <label htmlFor="delta-input" className="block text-xs text-[#687279] mb-1.5">
                手動加扣點（正值加點、負值扣點）
              </label>
              <div className="mb-2 flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    const n = Number(delta) || 0
                    setDelta(String(-Math.abs(n) || -1))
                  }}
                  aria-label="設為負值"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <input
                  id="delta-input"
                  type="number"
                  step="1"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                  placeholder="例：100 或 -50"
                  disabled={isPending}
                  className="flex-1 h-9 rounded-[10px] border border-[#10305a]/30 bg-white px-2 text-sm focus:border-[#10305a] focus:outline-none focus:ring-1 focus:ring-[#10305a]/30"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => {
                    const n = Number(delta) || 0
                    setDelta(String(Math.abs(n) || 1))
                  }}
                  aria-label="設為正值"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <textarea
                id="note-input"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                rows={2}
                placeholder="原因（必填）：補償客訴 / 活動加碼 / 訂單異常"
                disabled={isPending}
                className="w-full rounded-[10px] border border-[#10305a]/30 bg-white px-2 py-1.5 text-sm focus:border-[#10305a] focus:outline-none focus:ring-1 focus:ring-[#10305a]/30"
              />
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-zinc-400">剩餘 {500 - note.length} 字</p>
                <Button
                  size="sm"
                  onClick={handleAdjustPoints}
                  disabled={isPending || !delta || !note.trim()}
                >
                  {isPending ? "處理中…" : "送出"}
                </Button>
              </div>
            </div>
          </section>

          {/* Section 3 — 帳號管理 */}
          <section className="border-t p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#687279]">
              帳號管理
            </h3>
            <div className="mb-4">
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handleSendReset}
              >
                <KeyRound className="mr-1 h-3.5 w-3.5" />
                {isPending ? "寄送中…" : "發送密碼重設信"}
              </Button>
            </div>
            <div className="border-t pt-3">
              <p className="mb-2 text-[11px] text-red-600">⚠ 危險操作</p>
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() => setShowDisableConfirm(true)}
              >
                <Ban className="mr-1 h-3.5 w-3.5" />
                {isDisabled ? "恢復帳號" : "停用帳號"}
              </Button>
            </div>
          </section>

          <div className="sticky bottom-0 flex justify-end border-t bg-white px-4 py-3">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={isPending}>
              關閉
            </Button>
          </div>
        </div>
      </div>

      {showDisableConfirm && (
        <ConfirmDisableModal
          isDisabled={isDisabled}
          isPending={isPending}
          onConfirm={handleDisableConfirm}
          onClose={() => setShowDisableConfirm(false)}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Disable-account confirm modal (two-step)
// ---------------------------------------------------------------------------

function ConfirmDisableModal({
  isDisabled,
  isPending,
  onConfirm,
  onClose,
}: {
  isDisabled: boolean
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const action = isDisabled ? "恢復" : "停用"
  const danger = !isDisabled

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disable-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-white shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2
            id="disable-title"
            className={`text-sm font-semibold ${danger ? "text-red-700" : "text-[#10305a]"}`}
          >
            {action}帳號
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="關閉"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4 text-sm">
          {step === 1 ? (
            <p className="text-[#10305a]">
              {danger
                ? "確定要停用此帳號嗎？停用後該客戶將無法登入並下單。"
                : "確定要恢復此帳號嗎？"}
            </p>
          ) : (
            <p className="text-red-700 font-medium">
              再次確認：此操作將立即生效。
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
          >
            取消
          </Button>
          {step === 1 ? (
            <Button
              size="sm"
              variant={danger ? "destructive" : "default"}
              onClick={() => setStep(2)}
              disabled={isPending}
            >
              繼續
            </Button>
          ) : (
            <Button
              size="sm"
              variant={danger ? "destructive" : "default"}
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? "處理中…" : `確認${action}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
