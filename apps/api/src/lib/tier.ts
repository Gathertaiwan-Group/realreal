import { supabase } from "./supabase"
import { adjustPoints } from "./points"

const TIERS = [
  { name: "鑽石會員", minSpend: 30000 },
  { name: "金卡會員", minSpend: 10000 },
  { name: "銀卡會員", minSpend: 3000 },
  { name: "一般會員", minSpend: 0 },
] as const

export async function upgradeTierIfNeeded(userId: string, newTotalSpend: number) {
  // Fetch all tiers ordered by min_spend DESC
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, min_spend")
    .order("min_spend", { ascending: false })
  if (!tiers) return

  const eligible = tiers.find((t: { id: string; name: string; min_spend: number }) => newTotalSpend >= Number(t.min_spend))
  if (!eligible) return

  // Read existing tier BEFORE the update so we can detect a real change.
  const { data: existingProfile } = await supabase
    .from("user_profiles")
    .select("membership_tier_id")
    .eq("user_id", userId)
    .maybeSingle()
  const currentTierId =
    (existingProfile as { membership_tier_id: string | null } | null)
      ?.membership_tier_id ?? null

  await supabase
    .from("user_profiles")
    .update({ membership_tier_id: eligible.id, total_spend: newTotalSpend })
    .eq("user_id", userId)

  // Only fire tier_upgrade_bonus campaigns when the tier actually changed.
  if (eligible.id === currentTierId) return

  const now = new Date().toISOString()
  const { data: bonusCampaigns } = await supabase
    .from("campaigns")
    .select("id, name, config")
    .eq("type", "tier_upgrade_bonus")
    .eq("is_active", true)
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)

  for (const c of (bonusCampaigns ?? []) as Array<{
    id: string
    name: string
    config: { tier_id?: string; bonus_points?: number | string } | null
  }>) {
    if (c.config?.tier_id !== eligible.id) continue
    const bonus = Number(c.config?.bonus_points ?? 0)
    if (!Number.isFinite(bonus) || bonus <= 0) continue
    try {
      await adjustPoints(
        userId,
        bonus,
        `升等獎勵：${c.name}`,
        null,
        "promo",
        c.id,
      )
    } catch (err) {
      console.warn(
        `[tier_upgrade_bonus] failed to grant ${bonus} pts to ${userId} for campaign ${c.id}:`,
        err,
      )
    }
  }
}

export async function incrementSpendAndUpgrade(userId: string, amount: number) {
  // 1. Read current profile spend
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("total_spend, charity_savings, membership_tier_id")
    .eq("user_id", userId)
    .single()

  const currentSpend = Number(profile?.total_spend ?? 0)
  const newSpend = currentSpend + amount

  // 2. Upgrade tier (also persists new total_spend)
  await upgradeTierIfNeeded(userId, newSpend)

  // 3. Calculate and accumulate charity_savings based on the *new* tier
  const { data: updatedProfile } = await supabase
    .from("user_profiles")
    .select("membership_tier_id")
    .eq("user_id", userId)
    .single()

  if (updatedProfile?.membership_tier_id) {
    const { data: tier } = await supabase
      .from("membership_tiers")
      .select("rebate_rate")
      .eq("id", updatedProfile.membership_tier_id)
      .single()

    const rebateRate = Number(tier?.rebate_rate ?? 0) // e.g. 2.3 or 3.3
    if (rebateRate > 0) {
      // TODO(points-migration): grantPoints in lib/points.ts is now the SoT for
      // rewarding users on purchase. This charity_savings update is kept as a
      // legacy display-only mirror for backward compat; remove once all readers
      // migrate to the points_ledger / v_user_points_balance view.
      const charitySavingsIncrement = Math.round(amount * (rebateRate / 100) * 100) / 100
      const currentCharity = Number(profile?.charity_savings ?? 0)
      await supabase
        .from("user_profiles")
        .update({ charity_savings: currentCharity + charitySavingsIncrement })
        .eq("user_id", userId)
    }
  }
}

/**
 * Look up the discount rate for a user based on their membership tier.
 * Returns a value like 0.05 (5% off) or 0.10 (10% off), or 0 if no tier / guest.
 */
export async function getMemberDiscountRate(userId: string | undefined): Promise<number> {
  if (!userId) return 0

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("membership_tier_id")
    .eq("user_id", userId)
    .single()

  if (!profile?.membership_tier_id) return 0

  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("discount_rate")
    .eq("id", profile.membership_tier_id)
    .single()

  return tier ? Number(tier.discount_rate) : 0
}

/** Pure helper — compute which tier name applies given a spend amount and a sorted tiers list */
export function computeNewTier(
  totalSpend: number,
  tiers: Array<{ id: string; name: string; min_spend: number }>,
): { id: string; name: string; min_spend: number } | undefined {
  // Assumes tiers are already ordered by min_spend DESC
  return tiers.find((t) => totalSpend >= Number(t.min_spend))
}
