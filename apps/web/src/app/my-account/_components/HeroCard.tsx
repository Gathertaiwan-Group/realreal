import { Crown, ShoppingBag, Coins } from "lucide-react"

interface HeroCardProps {
  tierName: string
  totalOrders: number
  totalSpend: number
}

export function HeroCard({ tierName, totalOrders, totalSpend }: HeroCardProps) {
  return (
    <div className="mb-10 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[#10305a]/10 bg-zinc-200 md:grid-cols-3">
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
