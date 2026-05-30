import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"
import { AccountHeader } from "./_components/AccountHeader"
import { HeroCard } from "./_components/HeroCard"
import { PointsCard, type PointsLedgerRow } from "./_components/PointsCard"
import { RecentOrdersSection, type OrderRow } from "./_components/RecentOrdersSection"
import {
  SubscriptionsSection,
  type SubscriptionRow,
} from "./_components/SubscriptionsSection"
import { AccountSettingsSection } from "./_components/AccountSettingsSection"

export const metadata = { title: "我的帳戶 | 誠真生活 RealReal" }

interface SearchParams {
  section?: string
}

export default async function MyAccountPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login?redirect=/my-account")

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const accessToken = session?.access_token ?? ""

  // Fetch profile, orders, subscriptions, points balance + ledger in parallel.
  // Points endpoints may 404 / 500 against an older API deploy — fall back to
  // empty state so the page stays usable.
  const [
    profileResult,
    ordersResult,
    subscriptionsResult,
    balanceResult,
    ledgerResult,
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select(
        // Spec C Section 7: also need tier validity + period spend so HeroCard
        // can render "會員效期至…" + 達標 progress bar. requalify_* /
        // validity_months come from the joined membership_tiers row.
        "display_name, phone, total_spend, tier_started_at, tier_expires_at, tier_period_spend, membership_tiers(name, validity_months, requalify_amount, requalify_window_months)",
      )
      .eq("user_id", user.id)
      .single(),
    apiClient<{ data: OrderRow[] }>("/orders", { token: accessToken }).catch(
      () => ({ data: [] }) as { data: OrderRow[] },
    ),
    supabase
      .from("subscriptions")
      .select("id, status, subscription_plans(name, price, interval)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    apiClient<{ balance: number; expiring_soon: number }>("/points/balance", {
      token: accessToken,
    }).catch(() => ({ balance: 0, expiring_soon: 0 })),
    apiClient<{ rows: PointsLedgerRow[]; total: number }>(
      "/points/ledger?limit=20",
      { token: accessToken },
    ).catch(() => ({ rows: [] as PointsLedgerRow[], total: 0 })),
  ])

  const profile = profileResult.data
  const displayName =
    profile?.display_name?.trim() || user.email?.split("@")[0] || "會員"
  const totalSpend: number = profile?.total_spend ?? 0
  const rawTier = profile?.membership_tiers as unknown
  type TierRow = {
    name: string
    validity_months?: number | null
    requalify_amount?: number | string | null
    requalify_window_months?: number | null
  }
  const tier: TierRow | null = Array.isArray(rawTier)
    ? ((rawTier[0] as TierRow | undefined) ?? null)
    : ((rawTier as TierRow | null) ?? null)
  const tierName = tier?.name ?? "初心之友"
  const tierExpiresAt =
    (profile as { tier_expires_at?: string | null } | null)?.tier_expires_at ??
    null
  const tierPeriodSpend = Number(
    (profile as { tier_period_spend?: number | string | null } | null)
      ?.tier_period_spend ?? 0,
  )
  const requalifyAmount = Number(tier?.requalify_amount ?? 0)
  const validityMonths = Number(tier?.validity_months ?? 0)

  const orders: OrderRow[] = ordersResult.data ?? []
  const totalOrders = orders.length
  const recentOrders = orders.slice(0, 5)

  const subs: SubscriptionRow[] =
    (subscriptionsResult.data as unknown as SubscriptionRow[]) ?? []

  const pointsBalance = Number(balanceResult.balance ?? 0)
  const pointsExpiringSoon = Number(balanceResult.expiring_soon ?? 0)
  const pointsLedger: PointsLedgerRow[] = ledgerResult.rows ?? []

  // Old deep links redirect here with ?section=account-settings so the
  // accordion opens automatically.
  const sp = await searchParams
  const settingsOpen = sp.section === "account-settings"

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <AccountHeader displayName={displayName} />

      <HeroCard
        tierName={tierName}
        totalOrders={totalOrders}
        totalSpend={Number(totalSpend)}
        tierExpiresAt={tierExpiresAt}
        tierPeriodSpend={tierPeriodSpend}
        requalifyAmount={requalifyAmount}
        validityMonths={validityMonths}
      />

      <PointsCard
        balance={pointsBalance}
        expiringSoon={pointsExpiringSoon}
        ledger={pointsLedger}
      />

      <RecentOrdersSection orders={recentOrders} />

      <SubscriptionsSection subs={subs} />

      <AccountSettingsSection
        initialDisplayName={profile?.display_name ?? ""}
        initialPhone={(profile as { phone?: string | null } | null)?.phone ?? ""}
        email={user.email ?? ""}
        defaultOpen={settingsOpen}
      />
    </div>
  )
}
