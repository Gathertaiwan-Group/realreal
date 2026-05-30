import { Crown, ShoppingBag, Coins, CalendarClock } from "lucide-react"

interface HeroCardProps {
  tierName: string
  totalOrders: number
  totalSpend: number
  /** ISO timestamp; null = 永久會員 (e.g. 初心之友) */
  tierExpiresAt?: string | null
  /** 本期累積消費 (since tier_started_at) */
  tierPeriodSpend?: number
  /** 達標續約所需金額 */
  requalifyAmount?: number
  /** 續約週期月數 (用於警語「續約 N 個月」) */
  validityMonths?: number
}

export function HeroCard({
  tierName,
  totalOrders,
  totalSpend,
  tierExpiresAt = null,
  tierPeriodSpend = 0,
  requalifyAmount = 0,
  validityMonths = 0,
}: HeroCardProps) {
  return (
    <div className="mb-10 overflow-hidden rounded-2xl border border-[#10305a]/10">
      <div className="grid grid-cols-1 gap-px bg-zinc-200 md:grid-cols-3">
        {/* 會員等級 */}
        <Stat
          icon={<Crown className="h-5 w-5" />}
          label="會員等級"
          value={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#10305a] px-3 py-1 text-sm font-medium text-white">
              {tierName}
            </span>
          }
        />

        {/* 總訂單 */}
        <Stat
          icon={<ShoppingBag className="h-5 w-5" />}
          label="總訂單"
          value={
            <span className="text-2xl font-semibold text-[#10305a]">
              {totalOrders}{" "}
              <span className="text-base font-normal text-[#687279]">筆</span>
            </span>
          }
        />

        {/* 累計消費 */}
        <Stat
          icon={<Coins className="h-5 w-5" />}
          label="累計消費"
          value={
            <span className="text-2xl font-semibold text-[#10305a]">
              NT$ {totalSpend.toLocaleString()}
            </span>
          }
        />
      </div>

      {/* 會員效期 + 達標進度 (spec C Section 7) */}
      <TierValidityRow
        tierExpiresAt={tierExpiresAt}
        tierPeriodSpend={tierPeriodSpend}
        requalifyAmount={requalifyAmount}
        validityMonths={validityMonths}
      />
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-4 bg-white p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#10305a]/10 text-[#10305a]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-[#687279]">{label}</p>
        <div className="mt-1">{value}</div>
      </div>
    </div>
  )
}

function TierValidityRow({
  tierExpiresAt,
  tierPeriodSpend,
  requalifyAmount,
  validityMonths,
}: {
  tierExpiresAt: string | null
  tierPeriodSpend: number
  requalifyAmount: number
  validityMonths: number
}) {
  // 永久會員 (初心之友 etc): no expiry, no requalify rule
  if (!tierExpiresAt) {
    return (
      <div className="flex items-center gap-3 border-t border-[#10305a]/10 bg-white px-5 py-4 text-sm text-[#10305a]">
        <CalendarClock className="h-4 w-4 text-[#687279]" />
        <span className="font-medium">永久會員</span>
      </div>
    )
  }

  const expiresDate = new Date(tierExpiresAt)
  const expiresLabel = formatYmd(expiresDate)
  const daysToExpiry = Math.ceil(
    (expiresDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  )

  const showProgress = requalifyAmount > 0
  const remaining = Math.max(0, requalifyAmount - tierPeriodSpend)
  const pct = showProgress
    ? Math.min(100, Math.round((tierPeriodSpend / requalifyAmount) * 100))
    : 0

  // Spec: warning only when within 30 days of expiry and still need to spend more
  const showWarning =
    showProgress && remaining > 0 && daysToExpiry < 30 && daysToExpiry >= 0

  return (
    <div className="space-y-3 border-t border-[#10305a]/10 bg-white px-5 py-4">
      <div className="flex items-center gap-3 text-sm text-[#10305a]">
        <CalendarClock className="h-4 w-4 text-[#687279]" />
        <span>
          會員效期至 <span className="font-medium">{expiresLabel}</span>
        </span>
      </div>

      {showProgress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[#687279]">
            <span>本期累積消費</span>
            <span>
              NT$ {Math.round(tierPeriodSpend).toLocaleString()} / NT${" "}
              {Math.round(requalifyAmount).toLocaleString()}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-zinc-200"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="續約達標進度"
          >
            <div
              className="h-full bg-amber-400 transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {showWarning && (
        <p className="text-xs text-amber-700">
          再消費 NT$ {Math.round(remaining).toLocaleString()} 即可續約{" "}
          {validityMonths} 個月
        </p>
      )}
    </div>
  )
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}/${m}/${day}`
}
