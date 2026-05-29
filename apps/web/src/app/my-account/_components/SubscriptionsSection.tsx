import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"

export interface SubscriptionRow {
  id: string
  status: string
  subscription_plans: { name: string; price: string; interval: string } | null
}

/**
 * Caller is responsible for hiding this entire section when there are no
 * active subscriptions — we deliberately don't render an empty-state CTA
 * here because the redesign says "no subs → no section".
 */
export function SubscriptionsSection({ subs }: { subs: SubscriptionRow[] }) {
  if (subs.length === 0) return null

  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#10305a]">訂閱方案</h2>
        <Link
          href="/my-account/subscriptions"
          className="inline-flex items-center gap-1 text-sm text-[#10305a] hover:underline"
        >
          管理訂閱
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <ul className="overflow-hidden rounded-2xl border border-[#10305a]/10 bg-white">
        {subs.map((sub, i) => (
          <li
            key={sub.id}
            className={i > 0 ? "border-t border-zinc-100" : ""}
          >
            <Link
              href="/my-account/subscriptions"
              className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-zinc-50"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#10305a]">
                  {sub.subscription_plans?.name ?? "訂閱方案"}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  NT$ {Number(sub.subscription_plans?.price ?? 0).toLocaleString()}{" "}
                  / {sub.subscription_plans?.interval === "month" ? "月" : "年"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge>進行中</Badge>
                <ChevronRight className="h-4 w-4 text-zinc-400" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
