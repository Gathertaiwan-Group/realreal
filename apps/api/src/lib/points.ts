import { supabase } from "./supabase"
import { getSettingOrEnv } from "./settings"
import {
  evaluateAllCampaigns,
  type EvaluatorContext,
} from "./campaigns-evaluator"

/**
 * Points ledger lifecycle.
 *
 * Spec: docs/superpowers/specs/2026-05-30-points-tiers-customer-detail-design.md
 *
 * Five mutation entry points (earn / redeem / expire / refund / manual_adjust)
 * write append-only rows into `points_ledger`. Balance is always
 *   SELECT SUM(delta) FROM points_ledger WHERE user_id=?
 *
 * Settings live under `app_settings.points.*` and are read via the
 * existing getSettingOrEnv helper. Falls back to spec defaults when unset.
 */

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

const POINTS_SETTING_KEYS = [
  "points.ratio",
  "points.min_redeem",
  "points.max_redeem_pct",
  "points.allow_coupon_stack",
  "points.apply_to_shipping",
  "points.apply_to_sale",
  "points.expire_days",
] as const

export type PointsSettings = {
  ratio: number
  min_redeem: number
  max_redeem_pct: number
  allow_coupon_stack: boolean
  apply_to_shipping: boolean
  apply_to_sale: boolean
  expire_days: number
}

function toBool(v: string): boolean {
  return v === "true" || v === "1"
}

export async function loadPointsSettings(): Promise<PointsSettings> {
  const [ratio, minRedeem, maxPct, stack, shipping, sale, expireDays] =
    await Promise.all([
      getSettingOrEnv("points.ratio", "POINTS_RATIO", "1"),
      getSettingOrEnv("points.min_redeem", "POINTS_MIN_REDEEM", "0"),
      getSettingOrEnv("points.max_redeem_pct", "POINTS_MAX_REDEEM_PCT", "100"),
      getSettingOrEnv(
        "points.allow_coupon_stack",
        "POINTS_ALLOW_COUPON_STACK",
        "true",
      ),
      getSettingOrEnv(
        "points.apply_to_shipping",
        "POINTS_APPLY_TO_SHIPPING",
        "false",
      ),
      getSettingOrEnv("points.apply_to_sale", "POINTS_APPLY_TO_SALE", "true"),
      getSettingOrEnv("points.expire_days", "POINTS_EXPIRE_DAYS", "365"),
    ])
  return {
    ratio: Number(ratio),
    min_redeem: Number(minRedeem),
    max_redeem_pct: Number(maxPct),
    allow_coupon_stack: toBool(stack),
    apply_to_shipping: toBool(shipping),
    apply_to_sale: toBool(sale),
    expire_days: Number(expireDays),
  }
}

// ---------------------------------------------------------------------------
// 1. Earn — called when an order is paid
// ---------------------------------------------------------------------------

/**
 * Build a minimal EvaluatorContext for grantPoints. Looks up the user's
 * membership_tier_id and birthday from user_profiles; cart is left empty
 * (no items, subtotal=0, shipping_fee=0).
 *
 * Known limitation: with an empty cart, points_multiplier campaigns whose
 * scope=specific_categories cannot fire (resolveScopeItems will return []).
 * Acceptable for v1 — production code can be enhanced later to pass real
 * cart items into this helper.
 */
async function buildPointsContext(userId: string): Promise<EvaluatorContext> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("membership_tier_id, birthday")
    .eq("user_id", userId)
    .maybeSingle()

  const p = profile as {
    membership_tier_id: string | null
    birthday: string | null
  } | null

  return {
    user: {
      id: userId,
      tier_id: p?.membership_tier_id ?? null,
      birthday: p?.birthday ?? null,
    },
    cart: {
      items: [],
      subtotal: 0,
      shipping_fee: 0,
    },
  }
}

/**
 * Grant rebate points for an order. Looks up tier.rebate_rate (column, NOT
 * the JSON benefits field) and computes
 *   earned = floor(orderAmount * rebate_rate / 100)
 *
 * Then runs the campaigns evaluator and multiplies `earned` by the product
 * of every applied campaign's `rebate_multiplier` > 1 (e.g. points_multiplier
 * 2x + birthday_bonus 2x = 4x). Evaluator failures do NOT block the grant —
 * we log and continue with the base earned.
 *
 * Writes a single ledger row with source='earn'. Expiry is computed from
 * the `points.expire_days` setting (0 = never expire → NULL).
 *
 * Returns the number of points granted (0 if the tier has 0% rebate or
 * the tier doesn't exist).
 */
export async function grantPoints(
  orderId: string,
  userId: string,
  orderAmount: number,
  tierId: string | null,
): Promise<number> {
  if (!tierId) return 0

  // Audit M5 (round 2): grant must honor user's tier_expires_at — once a
  // tier expires, the user shouldn't earn the tier's rebate. getMemberDiscountRate
  // already does this for the discount side; we mirror it here for symmetry.
  const { data: tierExpireProfile } = await supabase
    .from("user_profiles")
    .select("tier_expires_at")
    .eq("user_id", userId)
    .maybeSingle()
  const tierExpiry = (tierExpireProfile as { tier_expires_at?: string | null } | null)?.tier_expires_at
  if (tierExpiry && new Date(tierExpiry) < new Date()) return 0

  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("rebate_rate")
    .eq("id", tierId)
    .maybeSingle()

  const rebateRate = Number((tier as { rebate_rate?: number } | null)?.rebate_rate ?? 0)
  if (rebateRate <= 0) return 0

  let earned = Math.floor((Number(orderAmount) * rebateRate) / 100)
  if (earned <= 0) return 0

  // Apply rebate multipliers from active campaigns (points_multiplier,
  // birthday_bonus). Evaluator failures are non-fatal: we still grant the
  // base rebate.
  let note: string | null = null
  try {
    const ctx = await buildPointsContext(userId)
    const results = await evaluateAllCampaigns(ctx)
    const multiplierResults = results.filter(
      (r) => (r.rebate_multiplier ?? 0) > 1,
    )
    const effectiveMultiplier = multiplierResults.reduce(
      (m, r) => m * (r.rebate_multiplier ?? 1),
      1,
    )
    if (effectiveMultiplier > 1) {
      earned = Math.round(earned * effectiveMultiplier)
      const ids = multiplierResults.map((r) => r.campaign_id).join(", ")
      note = ` × ${effectiveMultiplier} via campaigns [${ids}]`
    }
  } catch (err) {
    console.warn(
      `[grantPoints] campaign multiplier evaluation failed for user=${userId} order=${orderId}; continuing with base earned`,
      err,
    )
  }

  const expireDaysStr = await getSettingOrEnv(
    "points.expire_days",
    "POINTS_EXPIRE_DAYS",
    "365",
  )
  const expireDays = Number(expireDaysStr)
  const expiresAt =
    expireDays > 0
      ? new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString()
      : null

  // Idempotency guard — webhook retry or admin /retry-post-payment can fire
  // this twice for the same order. Migration 0032 also enforces a DB UNIQUE
  // partial index as a backstop; this SELECT-first is the friendly path.
  const { data: existing } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("source", "earn")
    .eq("source_ref_id", orderId)
    .maybeSingle()
  if (existing) {
    return 0
  }

  const { error: insertErr } = await supabase.from("points_ledger").insert({
    user_id: userId,
    delta: earned,
    source: "earn",
    source_ref_id: orderId,
    expires_at: expiresAt,
    ...(note ? { note } : {}),
  })
  // DB unique-violation (23505) from the partial index = lost a race; treat
  // as already-granted and return 0 quietly. Anything else logged.
  if (insertErr && insertErr.code !== "23505") {
    console.warn(`[grantPoints] insert failed for order=${orderId}:`, insertErr)
    return 0
  }
  if (insertErr?.code === "23505") return 0

  return earned
}

// ---------------------------------------------------------------------------
// 2. Redeem — called when an order is paid using points
// ---------------------------------------------------------------------------

/**
 * Burn points used on an order. Writes a single negative ledger row with
 * source='redeem'. No-op when pointsUsed <= 0.
 */
export async function redeemPoints(
  orderId: string,
  userId: string,
  pointsUsed: number,
): Promise<void> {
  if (pointsUsed <= 0) return
  // Idempotency guard — same hazards as grantPoints (webhook retry / admin
  // retry / IPN dual-notify). Migration 0032 enforces a DB UNIQUE partial
  // index too.
  const { data: existing } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("source", "redeem")
    .eq("source_ref_id", orderId)
    .maybeSingle()
  if (existing) return

  const { error: insertErr } = await supabase.from("points_ledger").insert({
    user_id: userId,
    delta: -Math.abs(pointsUsed),
    source: "redeem",
    source_ref_id: orderId,
  })
  if (insertErr && insertErr.code !== "23505") {
    console.warn(`[redeemPoints] insert failed for order=${orderId}:`, insertErr)
  }
}

// ---------------------------------------------------------------------------
// 3. Expire — daily cron worker
// ---------------------------------------------------------------------------

/**
 * Find earn rows whose `expires_at` has passed and which don't already
 * have a matching expire row. Write one -delta row per expired earn
 * referencing the earn row's id in `source_ref_id`.
 *
 * Returns the number of rows expired and the sum of points removed.
 */
export async function expirePoints(
  now: Date,
): Promise<{ rows: number; total: number }> {
  // 1. Pull candidate earn rows past their expiry. Audit M16 (round 2):
  // unbounded scan can OOM on a huge ledger. Cap at 1000 per worker tick;
  // cron runs daily so this still drains a backlog within days.
  const { data: earnRows, error: earnErr } = await supabase
    .from("points_ledger")
    .select("id, user_id, delta")
    .eq("source", "earn")
    .not("expires_at", "is", null)
    .lt("expires_at", now.toISOString())
    .limit(1000)
  if (earnErr) {
    console.error("[expirePoints] earnRows query failed:", earnErr)
    return { rows: 0, total: 0 }
  }

  if (!earnRows || earnRows.length === 0) {
    return { rows: 0, total: 0 }
  }

  // 2. Find any expire rows already covering these earn ids — skip those
  const earnIds = earnRows.map((r: any) => r.id as string)
  const { data: existingExpires } = await supabase
    .from("points_ledger")
    .select("source_ref_id")
    .eq("source", "expire")
    .in("source_ref_id", earnIds)

  const alreadyExpired = new Set<string>()
  for (const row of existingExpires ?? []) {
    const ref = (row as { source_ref_id: string | null }).source_ref_id
    if (ref) alreadyExpired.add(ref)
  }

  const toExpire = earnRows.filter((r: any) => !alreadyExpired.has(r.id))
  if (toExpire.length === 0) return { rows: 0, total: 0 }

  // 3. Insert expire rows
  const inserts = toExpire.map((r: any) => ({
    user_id: r.user_id as string,
    delta: -Number(r.delta),
    source: "expire",
    source_ref_id: r.id as string,
  }))

  const { error: insertErr } = await supabase.from("points_ledger").insert(inserts)
  if (insertErr) {
    console.error("[expirePoints] insert expire rows failed:", insertErr)
    return { rows: 0, total: 0 }
  }

  const total = toExpire.reduce(
    (acc: number, r: any) => acc + Number(r.delta),
    0,
  )
  return { rows: toExpire.length, total }
}

// ---------------------------------------------------------------------------
// 4. Refund — symmetric reversal of all earn + redeem rows for an order
// ---------------------------------------------------------------------------

/**
 * On order cancellation, reverse every earn AND redeem row pointing at the
 * order:
 *   - earn rows  → write -delta row (clawback)        source='refund'
 *   - redeem rows → write -delta row (positive flip)  source='refund'
 * Balance may legitimately go negative; we preserve audit truth.
 */
export async function refundOrderPoints(
  orderId: string,
  userId: string,
): Promise<{ earned_reverted: number; redeemed_returned: number }> {
  // Idempotency guard — admin clicking cancel twice, or PATCH status →
  // cancelled + later POST /cancel both would re-refund. No DB UNIQUE
  // index here because we legitimately insert 2 rows (earn revert +
  // redeem return) per order, so a partial unique index can't model it.
  // Check is at function level: if ANY refund row exists for this order,
  // skip the whole operation.
  const { data: prior } = await supabase
    .from("points_ledger")
    .select("id")
    .eq("source", "refund")
    .eq("source_ref_id", orderId)
    .eq("user_id", userId)
    .limit(1)
  if (prior && prior.length > 0) {
    return { earned_reverted: 0, redeemed_returned: 0 }
  }

  // earn rows for this order — claw back. Audit H11 (round 2): filter out
  // earn rows already expired by the expire cron, otherwise a refund after
  // expiry double-debits the user (we'd flip the earn delta back negative,
  // on top of the expire row that already balanced it).
  const { data: earnRows } = await supabase
    .from("points_ledger")
    .select("id, delta")
    .eq("source", "earn")
    .eq("source_ref_id", orderId)
    .eq("user_id", userId)

  const earnIds = (earnRows ?? []).map((r: any) => r.id as string)
  let alreadyExpiredEarnIds = new Set<string>()
  if (earnIds.length > 0) {
    const { data: expireRows } = await supabase
      .from("points_ledger")
      .select("source_ref_id")
      .eq("source", "expire")
      .in("source_ref_id", earnIds)
    alreadyExpiredEarnIds = new Set(
      (expireRows ?? [])
        .map((r: any) => r.source_ref_id as string | null)
        .filter((v): v is string => !!v),
    )
  }

  // redeem rows for this order — return points
  const { data: redeemRows } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("source", "redeem")
    .eq("source_ref_id", orderId)
    .eq("user_id", userId)

  const inserts: Array<{
    user_id: string
    delta: number
    source: string
    source_ref_id: string
    note: string
  }> = []

  let earnedReverted = 0
  for (const r of earnRows ?? []) {
    const earnRow = r as { id: string; delta: number }
    const d = Number(earnRow.delta)
    if (d === 0) continue
    // Skip earn rows already neutralised by an expire row — clawing them
    // back would double-debit the user.
    if (alreadyExpiredEarnIds.has(earnRow.id)) continue
    inserts.push({
      user_id: userId,
      delta: -d,
      source: "refund",
      source_ref_id: orderId,
      note: "earn revert",
    })
    earnedReverted += d
  }

  let redeemedReturned = 0
  for (const r of redeemRows ?? []) {
    const d = Number((r as { delta: number }).delta)
    if (d === 0) continue
    // redeem rows have negative delta; -d flips back to a positive credit
    inserts.push({
      user_id: userId,
      delta: -d,
      source: "refund",
      source_ref_id: orderId,
      note: "redeem return",
    })
    redeemedReturned += -d
  }

  if (inserts.length > 0) {
    await supabase.from("points_ledger").insert(inserts)
  }

  return { earned_reverted: earnedReverted, redeemed_returned: redeemedReturned }
}

// ---------------------------------------------------------------------------
// 5. Manual adjust — admin only
// ---------------------------------------------------------------------------

/**
 * Admin grants or revokes points manually, or system-initiated promo grants
 * (e.g. tier upgrade bonus, birthday bonus). The note is required (audit) and
 * must be a non-empty string after trim. expires_at is always NULL — manual
 * adjustments do not participate in the expiry sweep.
 *
 * `source` defaults to "manual_adjust" (admin path). System callers should
 * pass "promo" along with a `sourceRefId` (e.g. campaign id) for audit.
 * `actorId` may be null when the grant is system-initiated.
 */
export async function adjustPoints(
  userId: string,
  delta: number,
  note: string,
  actorId: string | null,
  source: "manual_adjust" | "promo" = "manual_adjust",
  sourceRefId: string | null = null,
): Promise<void> {
  if (typeof note !== "string" || note.trim() === "") {
    throw new Error("note is required for manual point adjustment")
  }
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("delta must be a non-zero finite number")
  }
  await supabase.from("points_ledger").insert({
    user_id: userId,
    delta: Math.trunc(delta),
    source,
    source_ref_id: sourceRefId,
    note: note.trim(),
    actor_id: actorId,
    expires_at: null,
  })
}

// ---------------------------------------------------------------------------
// Balance read
// ---------------------------------------------------------------------------

/**
 * Single-user balance read. SUM(delta) over every row for the user.
 * Returns 0 when the user has no ledger rows.
 */
export async function getUserBalance(userId: string): Promise<number> {
  const { data } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("user_id", userId)

  if (!data) return 0
  return data.reduce(
    (acc: number, r: any) => acc + Number(r.delta ?? 0),
    0,
  )
}

/**
 * Spendable balance for checkout-time redemption.
 *
 * This is stricter than the plain ledger SUM:
 * - expired earn rows are excluded even if the expiry cron has not swept them
 * - points already claimed by pending/paid orders are subtracted until their
 *   redeem ledger rows exist
 */
export async function getEffectiveRedeemablePoints(
  userId: string,
  now = new Date(),
): Promise<number> {
  const { data: ledgerRows } = await supabase
    .from("points_ledger")
    .select("delta, source, expires_at")
    .eq("user_id", userId)

  const balance = (ledgerRows ?? []).reduce((acc: number, r: any) => {
    const delta = Number(r.delta ?? 0)
    if (
      r.source === "earn" &&
      r.expires_at &&
      new Date(r.expires_at) < now
    ) {
      return acc
    }
    return acc + delta
  }, 0)

  const { data: inflightOrders } = await supabase
    .from("orders")
    .select("id, points_used")
    .eq("user_id", userId)
    .in("payment_status", ["pending", "paid"])
    .gt("points_used", 0)

  let inflightPoints = 0
  for (const order of (inflightOrders ?? []) as Array<{ id: string; points_used: number }>) {
    const orderPoints = Number(order.points_used ?? 0)
    if (orderPoints <= 0) continue

    const { data: existing } = await supabase
      .from("points_ledger")
      .select("id")
      .eq("source", "redeem")
      .eq("source_ref_id", order.id)
      .maybeSingle()
    if (!existing) inflightPoints += orderPoints
  }

  return balance - inflightPoints
}

// ---------------------------------------------------------------------------
// Pure calc — checkout uses this synchronously
// ---------------------------------------------------------------------------

export type CartForPoints = {
  subtotal: number
  shipping: number
  sale_item_total: number
  total: number
}

export type PointsDiscountResult =
  | { allowed: true; discount: number }
  | { allowed: false; reason: string; discount: 0 }

/**
 * Pure function — given cart totals, the requested points to redeem, and
 * the settings snapshot, returns whether the redemption is allowed and
 * how much NT$ it discounts.
 *
 * Only `settings.ratio` is consumed from the snapshot. Per Spec D
 * (2026-05-30-D-points-rules-simplification), the previously per-tenant
 * tunables `min_redeem`, `max_redeem_pct`, `apply_to_shipping`,
 * `apply_to_sale`, and `allow_coupon_stack` are now hardcoded sensible
 * defaults — admins who need different behavior for a specific promo
 * should configure a campaign override (future spec) rather than a
 * global setting. `allow_coupon_stack` is not consulted here; orders.ts
 * decides coupon+points stacking (always true under Spec D).
 *
 *   eligible = (APPLY_TO_SHIPPING ? total : subtotal)
 *            - (APPLY_TO_SALE ? 0 : sale_item_total)
 *   cap      = floor(eligible * MAX_REDEEM_PCT / 100)
 *   maxPts   = floor(cap / ratio)
 */
export function calcPointsDiscount(
  cart: CartForPoints,
  requestedPoints: number,
  settings: Pick<PointsSettings, "ratio">,
): PointsDiscountResult {
  // Spec D hardcoded defaults — was settings.{min_redeem,max_redeem_pct,
  // apply_to_shipping,apply_to_sale}. Keep names in SCREAMING_SNAKE_CASE to
  // signal they are no longer per-tenant tunables.
  const MIN_REDEEM = 0
  const MAX_REDEEM_PCT = 100
  const APPLY_TO_SHIPPING = false
  const APPLY_TO_SALE = true

  const requested = Math.trunc(Number(requestedPoints) || 0)

  if (requested <= 0) {
    return { allowed: false, reason: "請輸入要折抵的點數", discount: 0 }
  }

  const ratio = Number(settings.ratio)

  if (ratio <= 0) {
    return { allowed: false, reason: "點數換算比例無效", discount: 0 }
  }

  if (requested < MIN_REDEEM) {
    return { allowed: false, reason: `最少 ${MIN_REDEEM} 點`, discount: 0 }
  }

  const base = APPLY_TO_SHIPPING ? Number(cart.total) : Number(cart.subtotal)
  const eligible =
    base - (APPLY_TO_SALE ? 0 : Number(cart.sale_item_total))
  const safeEligible = Math.max(0, eligible)

  const cap = Math.floor((safeEligible * MAX_REDEEM_PCT) / 100)
  const maxPoints = Math.floor(cap / ratio)

  if (requested > maxPoints) {
    return { allowed: false, reason: `最多 ${maxPoints} 點`, discount: 0 }
  }

  return { allowed: true, discount: requested * ratio }
}
