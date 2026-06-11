import { supabase } from "./supabase"
import { adjustPoints } from "./points"

const TIERS = [
  { name: "鑽石會員", minSpend: 30000 },
  { name: "金卡會員", minSpend: 10000 },
  { name: "銀卡會員", minSpend: 3000 },
  { name: "一般會員", minSpend: 0 },
] as const

/**
 * Add `n` months to a Date, returning a new Date. Pure / sync utility, no deps.
 * Handles end-of-month overflow the JS-standard way (e.g. Jan 31 + 1mo → Mar 3).
 */
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date.getTime())
  d.setMonth(d.getMonth() + n)
  return d
}

export async function upgradeTierIfNeeded(userId: string, newTotalSpend: number) {
  // Fetch all tiers ordered by min_spend DESC (need validity_months for expiry calc)
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, min_spend, validity_months")
    .order("min_spend", { ascending: false })
  if (!tiers) return

  const eligible = tiers.find(
    (t: { id: string; name: string; min_spend: number; validity_months: number | null }) =>
      newTotalSpend >= Number(t.min_spend),
  ) as { id: string; name: string; min_spend: number; validity_months: number | null } | undefined
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

  // On no-change, just keep total_spend in sync (don't reset period/started/expires).
  if (eligible.id === currentTierId) {
    await supabase
      .from("user_profiles")
      .update({ total_spend: newTotalSpend })
      .eq("user_id", userId)
    return
  }

  // Tier changed → stamp tier_started_at, compute tier_expires_at, reset tier_period_spend.
  const nowDate = new Date()
  const now = nowDate.toISOString()
  const validityMonths = Number(eligible.validity_months ?? 0)
  const tierExpiresAt =
    validityMonths > 0 ? addMonths(nowDate, validityMonths).toISOString() : null

  await supabase
    .from("user_profiles")
    .update({
      membership_tier_id: eligible.id,
      total_spend: newTotalSpend,
      tier_started_at: now,
      tier_expires_at: tierExpiresAt,
      tier_period_spend: 0,
    })
    .eq("user_id", userId)

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

/**
 * Add `amount` to the user's `tier_period_spend` (re-qualification window total).
 * Called from enqueue-post-payment after every successful order.
 *
 * Read-then-write rather than a Postgres RPC; race condition tolerable at current
 * traffic (a concurrent payment from the same user could drop one increment).
 * Migrate to `SET tier_period_spend = tier_period_spend + ?` via RPC if that ever
 * becomes a real problem.
 */
export async function incrementPeriodSpend(userId: string, amount: number) {
  if (!Number.isFinite(amount) || amount === 0) return
  await supabase.rpc("increment_user_tier_spend", {
    p_user_id: userId,
    p_amount: amount,
  })
}

/**
 * Reverse of incrementSpendAndUpgrade — used by the cancel chain to undo the
 * spend bookkeeping when a paid order is refunded. Round-2 audit (2026-06-09)
 * found refunded orders were permanently boosting tier eligibility (wash-trade
 * vector for 鑽石會員 status). Migration 0033 adds order_post_payment_log.
 * spend_decremented_at as the idempotency sentinel so a retried cancel /
 * status-flip doesn't double-decrement.
 *
 * Decrements three columns (each clamped at 0):
 *   - user_profiles.total_spend
 *   - user_profiles.tier_period_spend
 *   - user_profiles.charity_savings (legacy display mirror)
 *
 * Does NOT auto-downgrade — tier stays as-is and the user keeps the rebate
 * benefits for the rest of the period. The tier-expire worker re-evaluates
 * at requalification time using the decremented numbers, so a wash-trade
 * eventually corrects itself instead of becoming permanent.
 */
export async function decrementSpendOnRefund(
  orderId: string,
  userId: string,
  amount: number,
): Promise<{ decremented: boolean; total_spend_delta: number; period_spend_delta: number; charity_delta: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { decremented: false, total_spend_delta: 0, period_spend_delta: 0, charity_delta: 0 }
  }

  // Idempotency sentinel ordering — claim_order_post_payment_step sets
  // spend_decremented_at and returns TRUE only the first time; it has NO
  // reset/unclaim RPC (see migration 0034). The OLD order was claim-THEN-
  // decrement: if decrement_user_tier_spend failed, the sentinel was already
  // consumed, so the warn+return left it permanently claimed and the refund's
  // spend was never reversed → re-opened wash-trade tier upgrades.
  //
  // Fix (approach a): run the decrement RPC FIRST and only claim the step once
  // it has succeeded. A failed decrement now leaves the step UNclaimed, so the
  // cancel chain can safely retry. The claim still runs afterwards and remains
  // the idempotency guard against a retried/duplicate cancel (a second run sees
  // the sentinel set and skips). This mirrors the increment side, where the
  // claim in enqueue-post-payment.ts only counts a step as done after the
  // atomic RPC actually ran.
  //
  // First peek at the pre-decrement profile (best-effort, for the returned
  // deltas only). We re-read after the decrement to compute exact deltas.
  const { data: before } = await supabase
    .from("user_profiles")
    .select("total_spend, tier_period_spend, charity_savings")
    .eq("user_id", userId)
    .maybeSingle()
  const currentTotal = Number((before as any)?.total_spend ?? 0)
  const currentPeriod = Number((before as any)?.tier_period_spend ?? 0)
  const currentCharity = Number((before as any)?.charity_savings ?? 0)

  // Guard against an already-processed refund BEFORE mutating spend. We read
  // the sentinel (without consuming it) so a retried cancel does not double-
  // decrement in the window before we claim. The authoritative claim still
  // happens after the decrement; this is just an early-out.
  const { data: priorLog } = await supabase
    .from("order_post_payment_log")
    .select("spend_decremented_at")
    .eq("order_id", orderId)
    .maybeSingle()
  if ((priorLog as { spend_decremented_at?: string | null } | null)?.spend_decremented_at) {
    return { decremented: false, total_spend_delta: 0, period_spend_delta: 0, charity_delta: 0 }
  }

  // Decrement FIRST. If this fails, no sentinel is consumed → safe to retry.
  const { data: afterRows, error: decErr } = await supabase.rpc(
    "decrement_user_tier_spend",
    { p_user_id: userId, p_amount: amount },
  )
  if (decErr) {
    console.warn(`[decrementSpendOnRefund] rpc failed for order=${orderId}:`, decErr)
    return { decremented: false, total_spend_delta: 0, period_spend_delta: 0, charity_delta: 0 }
  }
  const after = Array.isArray(afterRows) ? afterRows[0] : afterRows

  // Only now claim the step. The decrement succeeded; record the sentinel so a
  // retried cancel skips. (If this claim somehow errors, the decrement has
  // already applied — we surface it so the caller logs it; a re-run would be
  // gated by the early-out read above on the next attempt once the row exists.)
  const { error: claimErr } = await supabase.rpc(
    "claim_order_post_payment_step",
    { p_order_id: orderId, p_step: "spend_decremented" },
  )
  if (claimErr) {
    console.warn(
      `[decrementSpendOnRefund] decrement applied but claim failed for order=${orderId}:`,
      claimErr,
    )
  }

  return {
    decremented: true,
    total_spend_delta: currentTotal - Number((after as any)?.total_spend ?? currentTotal),
    period_spend_delta: currentPeriod - Number((after as any)?.tier_period_spend ?? currentPeriod),
    charity_delta: currentCharity - Number((after as any)?.charity_savings ?? currentCharity),
  }
}

export async function incrementSpendAndUpgrade(userId: string, amount: number) {
  const { data, error } = await supabase.rpc("increment_user_tier_spend", {
    p_user_id: userId,
    p_amount: amount,
  })
  if (error) throw error

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.tier_changed || !row.membership_tier_id) return

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
    if (c.config?.tier_id !== row.membership_tier_id) continue
    const bonus = Number(c.config?.bonus_points ?? 0)
    if (!Number.isFinite(bonus) || bonus <= 0) continue
    try {
      await adjustPoints(userId, bonus, `升等獎勵：${c.name}`, null, "promo", c.id)
    } catch (err) {
      console.warn(
        `[tier_upgrade_bonus] failed to grant ${bonus} pts to ${userId} for campaign ${c.id}:`,
        err,
      )
    }
  }
}

/**
 * Look up the discount rate for a user based on their membership tier.
 * Returns a value like 0.05 (5% off) or 0.10 (10% off), or 0 if no tier / guest.
 */
export async function getMemberDiscountRate(userId: string | undefined): Promise<number> {
  if (!userId) return 0

  // Runtime expire check (audit H4) — even if tier-expire-worker hasn't swept
  // yet, an expired tier should give 0 discount. .single() can also throw on
  // missing profile; swap to .maybeSingle() so we silently return 0 rather
  // than 500 (audit L8).
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("membership_tier_id, tier_expires_at")
    .eq("user_id", userId)
    .maybeSingle()

  if (!profile?.membership_tier_id) return 0
  const expiresAt = (profile as { tier_expires_at?: string | null }).tier_expires_at
  if (expiresAt && new Date(expiresAt) < new Date()) return 0

  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("discount_rate")
    .eq("id", profile.membership_tier_id)
    .maybeSingle()

  // Invariant guard (audit H5) — clamp discount_rate to [0, 1] so an admin
  // typo (e.g. 95 instead of 0.95) can't price an order to NT$0 or negative.
  const raw = tier ? Number(tier.discount_rate) : 0
  if (!Number.isFinite(raw) || raw <= 0) return 0
  if (raw >= 1) {
    console.warn(`[getMemberDiscountRate] discount_rate=${raw} for user=${userId} is invalid (must be < 1); clamping to 0`)
    return 0
  }
  return raw
}

/** Pure helper — compute which tier name applies given a spend amount and a sorted tiers list */
export function computeNewTier(
  totalSpend: number,
  tiers: Array<{ id: string; name: string; min_spend: number }>,
): { id: string; name: string; min_spend: number } | undefined {
  // Assumes tiers are already ordered by min_spend DESC
  return tiers.find((t) => totalSpend >= Number(t.min_spend))
}
