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
      .select("display_name, phone, total_spend, membership_tiers(name)")
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
  const tierName =
    (Array.isArray(rawTier)
      ? (rawTier[0] as { name: string } | undefined)?.name
      : (rawTier as { name: string } | null)?.name) ?? "初心之友"

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
