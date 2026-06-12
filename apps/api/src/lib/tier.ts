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
 * B4: re-evaluate a user's tier after their total_spend dropped (e.g. a refund)
 * and downgrade immediately if they no longer meet their current tier's
 * min_spend. Picks the highest tier whose min_spend <= newTotalSpend.
 *
 * Reads membership_tiers ordered by min_spend ASC and walks to the highest
 * qualifying one. Only writes when the tier actually changes, and surfaces any
 * write error to the caller (checked `.error`). Returns the resulting tier id
 * (unchanged or downgraded), or null if it couldn't evaluate.
 *
 * NOTE: this is the *immediate* downgrade-on-refund. The separate non-expiring-
 * tier sweep (a tier with validity_months = NULL never hits tier-expire.ts, so
 * a wash-trade that doesn't cross min_spend wouldn't otherwise be reconsidered)
 * is tracked separately and intentionally NOT handled here (tier-expire.ts is
 * out of scope for this change).
 */
async function downgradeTierIfBelowMin(
  userId: string,
  newTotalSpend: number,
  currentTierId: string | null,
): Promise<{ ok: boolean; tierId: string | null; changed: boolean; error?: string }> {
  // Ascending so we can scan for the highest tier still satisfied by the
  // (now lower) spend.
  const { data: tiers, error: tiersErr } = await supabase
    .from("membership_tiers")
    .select("id, min_spend")
    .order("min_spend", { ascending: true })
  if (tiersErr) {
    console.warn(`[downgradeTierIfBelowMin] tiers query failed for user=${userId}:`, tiersErr)
    return { ok: false, tierId: currentTierId, changed: false, error: tiersErr.message }
  }
  const rows = (tiers ?? []) as Array<{ id: string; min_spend: number | string }>
  if (rows.length === 0) {
    return { ok: true, tierId: currentTierId, changed: false }
  }

  // Highest tier whose min_spend <= newTotalSpend (rows are ASC by min_spend).
  let target: { id: string; min_spend: number | string } | null = null
  for (const t of rows) {
    if (newTotalSpend >= Number(t.min_spend)) target = t
  }
  // No tier qualifies (e.g. negative spend) → fall back to the lowest tier.
  if (!target) target = rows[0]

  const currentMinSpend = (() => {
    const cur = rows.find((t) => t.id === currentTierId)
    return cur ? Number(cur.min_spend) : null
  })()

  // Only act when the user is genuinely below their current tier's floor.
  // If we can't find their current tier in the list (stale FK / null), still
  // apply the computed target so the profile self-heals.
  const belowCurrentFloor =
    currentMinSpend === null || newTotalSpend < currentMinSpend
  if (!belowCurrentFloor || target.id === currentTierId) {
    return { ok: true, tierId: currentTierId, changed: false }
  }

  const { error: updErr } = await supabase
    .from("user_profiles")
    .update({ membership_tier_id: target.id })
    .eq("user_id", userId)
  if (updErr) {
    console.warn(`[downgradeTierIfBelowMin] downgrade update failed for user=${userId}:`, updErr)
    return { ok: false, tierId: currentTierId, changed: false, error: updErr.message }
  }
  return { ok: true, tierId: target.id, changed: true }
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
 * B2: the claim + decrement is now ONE atomic RPC
 * (`claim_and_decrement_tier_spend`, migration 0037) instead of the previous
 * read-sentinel → decrement → claim sequence. The old shape let two concurrent
 * cancels both pass the early-out sentinel read and each run the decrement
 * before either claimed → double-decrement. The RPC does the claim + decrement
 * in a single transaction and rolls the decrement back if the claim didn't win,
 * so concurrency is safe and the decision (`claimed`) is authoritative.
 *
 * B4: after a successful claim we re-evaluate the tier and downgrade
 * immediately if total_spend fell below the current tier's min_spend (the old
 * code never downgraded, so a wash-trade kept its tier until — for expiring
 * tiers — the tier-expire worker swept it; non-expiring tiers never got swept).
 */
export async function decrementSpendOnRefund(
  orderId: string,
  userId: string,
  amount: number,
): Promise<{ decremented: boolean; total_spend_delta: number; period_spend_delta: number; charity_delta: number }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { decremented: false, total_spend_delta: 0, period_spend_delta: 0, charity_delta: 0 }
  }

  // Best-effort pre-state read for the returned deltas ONLY. The decision to
  // decrement and the decrement itself come exclusively from the RPC below —
  // never from this read — so a concurrent cancel reading the same pre-state
  // cannot cause a double-decrement (only one RPC call wins the claim).
  const { data: before } = await supabase
    .from("user_profiles")
    .select("total_spend, tier_period_spend, charity_savings, membership_tier_id")
    .eq("user_id", userId)
    .maybeSingle()
  const currentTotal = Number((before as any)?.total_spend ?? 0)
  const currentPeriod = Number((before as any)?.tier_period_spend ?? 0)
  const currentCharity = Number((before as any)?.charity_savings ?? 0)
  const currentTierId = ((before as any)?.membership_tier_id ?? null) as string | null

  // Atomic claim + decrement. `claimed=false` → another cancel already did it
  // (or this is a duplicate webhook) → no-op. `claimed=true` → this call owns
  // the decrement and the returned totals are post-decrement.
  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    "claim_and_decrement_tier_spend",
    { p_order_id: orderId, p_user_id: userId, p_amount: amount },
  )
  if (rpcErr) {
    console.warn(`[decrementSpendOnRefund] rpc failed for order=${orderId}:`, rpcErr)
    return { decremented: false, total_spend_delta: 0, period_spend_delta: 0, charity_delta: 0 }
  }
  const rpc = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
  const claimed = Boolean((rpc as any)?.claimed)
  if (!claimed) {
    // Already decremented by a prior/concurrent cancel — idempotent no-op.
    return { decremented: false, total_spend_delta: 0, period_spend_delta: 0, charity_delta: 0 }
  }

  const newTotal = Number((rpc as any)?.total_spend ?? currentTotal)
  const newPeriod = Number((rpc as any)?.tier_period_spend ?? currentPeriod)
  const newCharity = Number((rpc as any)?.charity_savings ?? currentCharity)

  // B4: immediate downgrade if the refund dropped them below their tier floor.
  // Non-fatal to the spend reversal — a downgrade write failure is logged but
  // doesn't undo the (already-committed) decrement.
  try {
    await downgradeTierIfBelowMin(userId, newTotal, currentTierId)
  } catch (err) {
    console.warn(
      `[decrementSpendOnRefund] tier re-eval failed for order=${orderId} (spend already decremented):`,
      err,
    )
  }

  return {
    decremented: true,
    total_spend_delta: currentTotal - newTotal,
    period_spend_delta: currentPeriod - newPeriod,
    charity_delta: currentCharity - newCharity,
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
