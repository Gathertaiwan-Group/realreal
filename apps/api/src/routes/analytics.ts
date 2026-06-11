import { Router } from "express"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"

export const analyticsRouter = Router()

// ---------------------------------------------------------------------------
// GET /admin/analytics/membership — tier distribution + top 20 customers
// ---------------------------------------------------------------------------

analyticsRouter.get("/admin/analytics/membership", requireAuth, requireAdmin, async (_req, res) => {
  // Tier distribution: count of users per tier
  const { data: tierDist, error: tierErr } = await supabase
    .from("user_profiles")
    .select("membership_tier_id, membership_tiers(name)", { count: "exact" })
    .order("membership_tier_id")

  if (tierErr) { res.status(500).json({ error: tierErr.message }); return }

  // Aggregate tier counts in JS (Supabase JS v2 doesn't expose GROUP BY natively)
  const tierMap: Record<string, { tier_id: string; tier_name: string; count: number }> = {}
  for (const row of (tierDist ?? [])) {
    const key = row.membership_tier_id as string ?? "none"
    const tierName = (row as Record<string, unknown>).membership_tiers as { name?: string } | null
    if (!tierMap[key]) {
      tierMap[key] = { tier_id: key, tier_name: tierName?.name ?? "未設定", count: 0 }
    }
    tierMap[key].count++
  }

  // Top 20 customers by total_spend
  const { data: topCustomers, error: topErr } = await supabase
    .from("user_profiles")
    .select("user_id, total_spend, membership_tiers(name)")
    .order("total_spend", { ascending: false })
    .limit(20)

  if (topErr) { res.status(500).json({ error: topErr.message }); return }

  res.json({
    data: {
      tier_distribution: Object.values(tierMap),
      top_customers: (topCustomers ?? []).map((c) => ({
        user_id: c.user_id,
        total_spend: c.total_spend,
        tier_name: (c as Record<string, unknown>).membership_tiers
          ? ((c as Record<string, unknown>).membership_tiers as { name?: string })?.name ?? null
          : null,
      })),
    },
  })
})

// ---------------------------------------------------------------------------
// GET /admin/analytics/orders — daily revenue last 30 days + orders by status
// ---------------------------------------------------------------------------

analyticsRouter.get("/admin/analytics/orders", requireAuth, requireAdmin, async (_req, res) => {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const since = thirtyDaysAgo.toISOString()

  // Fetch orders from last 30 days
  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .select("id, total, status, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true })

  if (ordersErr) { res.status(500).json({ error: ordersErr.message }); return }

  // Daily revenue aggregation
  const dailyMap: Record<string, number> = {}
  const statusMap: Record<string, number> = {}

  for (const order of (orders ?? [])) {
    const day = (order.created_at as string).slice(0, 10) // YYYY-MM-DD
    dailyMap[day] = (dailyMap[day] ?? 0) + Number(order.total ?? 0)

    const status = (order.status as string) ?? "unknown"
    statusMap[status] = (statusMap[status] ?? 0) + 1
  }

  const daily_revenue = Object.entries(dailyMap).map(([date, revenue]) => ({ date, revenue }))
  const orders_by_status = Object.entries(statusMap).map(([status, count]) => ({ status, count }))

  res.json({
    data: {
      daily_revenue,
      orders_by_status,
    },
  })
})
