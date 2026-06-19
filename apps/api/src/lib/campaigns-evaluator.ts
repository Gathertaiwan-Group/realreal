import { supabase } from "./supabase"

/* ============================================================================
 * Exported types
 * ========================================================================== */

export type CartItem = {
  product_id: string
  variant_id: string
  category_id: string | null
  sku: string | null
  name: string
  /** Dollar amount (not cents). Evaluator math is done in dollars; orders.ts converts to cents. */
  unit_price: number
  qty: number
}

export type EvaluatorContext = {
  user: {
    id: string
    tier_id: string | null
    /** ISO date string (YYYY-MM-DD) or null. */
    birthday: string | null
    /** ISO timestamp string or null; used by first_purchase optional days_since_signup check. */
    created_at?: string | null
    /**
     * Sandbox override for first_purchase evaluation (admin test bench).
     * Real checkout NEVER sets this — evalFirstPurchase falls back to DB.
     * true  = pretend user is first-purchase eligible (no past paid orders)
     * false = pretend user already has past paid orders
     */
    _is_first_purchase_override?: boolean
  }
  cart: {
    items: CartItem[]
    /** Sum of unit_price × qty in dollars. */
    subtotal: number
    /** Shipping fee in dollars. */
    shipping_fee: number
  }
}

export type FreeItem = {
  sku?: string
  product_id?: string
  qty: number
  name?: string
  /** Optional unit price (dollars) — used by pickBestPerType to score freebie campaigns. */
  unit_price?: number
}

export type EvaluatorResult = {
  campaign_id: string
  campaign_name: string
  type: string
  applied: boolean
  /** Reason for non-application; only set when applied=false. */
  reason?: string
  /** Discount applied to subtotal, in dollars. */
  discount_amount?: number
  /** Free items granted by this campaign. */
  free_items?: FreeItem[]
  /** Rebate multiplier — for points_multiplier / birthday_bonus campaigns. */
  rebate_multiplier?: number
  /** Free shipping flag — for free_shipping campaigns. */
  zero_shipping?: boolean
}

/* ============================================================================
 * Campaign row shape (mirrors `campaigns` table columns we read)
 * ========================================================================== */

type CampaignRow = {
  id: string
  name: string
  type: string
  is_active: boolean
  starts_at: string
  ends_at: string | null
  tier_id: string | null
  config: Record<string, unknown> | null
}

/* ============================================================================
 * Internal helpers — slug → category id cache
 * ========================================================================== */

const categorySlugCache = new Map<string, string>()

async function getCategoryIdBySlug(slug: string): Promise<string | undefined> {
  if (categorySlugCache.has(slug)) {
    return categorySlugCache.get(slug)
  }
  const { data } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()
  if (data?.id) {
    categorySlugCache.set(slug, data.id)
    return data.id
  }
  return undefined
}

async function isFirstPurchase(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false // guest 不算首購
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["processing", "shipped", "completed"])
  if (error) {
    console.warn("[first-purchase] check failed:", error.message)
    return false // fail closed
  }
  return (count ?? 0) === 0
}

async function resolveScopeItems(
  scope: string | undefined | null,
  slug: string | undefined | null,
  items: CartItem[],
): Promise<CartItem[]> {
  if (scope === "all") return items
  if (!slug) return []
  const catId = await getCategoryIdBySlug(slug)
  if (!catId) return []
  return items.filter((i) => i.category_id === catId)
}

function explodeUnits(items: CartItem[]): CartItem[] {
  return items.flatMap((i) =>
    Array.from({ length: i.qty }, () => ({ ...i, qty: 1 })),
  )
}

function sumItems(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.unit_price * i.qty, 0)
}

/**
 * Returns true if `now` (default: runtime now) falls within the birthday window.
 * Window: from one day before birthday-this-year through `windowDays` days after.
 * Accepts explicit `now` for deterministic testing.
 */
function isInBirthdayWindow(
  birthday: string,
  windowDays: number,
  now: Date = new Date(),
): boolean {
  // Parse birthday string YYYY-MM-DD via String split (no Date constructor → no UTC drift)
  const parts = birthday.split("-")
  if (parts.length < 3) return false
  const bMonth = Number(parts[1])
  const bDay = Number(parts[2])
  if (!Number.isFinite(bMonth) || !Number.isFinite(bDay)) return false

  // Convert "now" UTC to Asia/Taipei wall-clock by adding 8h offset
  const tpeNow = new Date(now.getTime() + 8 * 3600 * 1000)
  const tpeYear = tpeNow.getUTCFullYear()
  const tpeMonth = tpeNow.getUTCMonth() + 1
  const tpeDay = tpeNow.getUTCDate()

  // Build two anchor timestamps (this-year + next-year birthday at TPE 00:00 → UTC = TPE - 8h)
  const tpeNowMs = Date.UTC(tpeYear, tpeMonth - 1, tpeDay)
  const thisYearMs = Date.UTC(tpeYear, bMonth - 1, bDay)
  const nextYearMs = Date.UTC(tpeYear + 1, bMonth - 1, bDay)
  const prevYearMs = Date.UTC(tpeYear - 1, bMonth - 1, bDay)

  const diffThis = (tpeNowMs - thisYearMs) / 86_400_000
  const diffNext = (tpeNowMs - nextYearMs) / 86_400_000
  const diffPrev = (tpeNowMs - prevYearMs) / 86_400_000

  // Pick anchor whose |diff| is smallest
  let bestDiff = diffThis
  if (Math.abs(diffNext) < Math.abs(bestDiff)) bestDiff = diffNext
  if (Math.abs(diffPrev) < Math.abs(bestDiff)) bestDiff = diffPrev

  // Audit M3 (round 2): docstring says "one day before through `windowDays`
  // days after". Implementation was using a symmetric ±half-window, which
  // didn't match the test cases (test expects birthday+29d still in window
  // with windowDays=30) or the docstring. Make it asymmetric: [-1, +windowDays].
  return bestDiff >= -1 && bestDiff <= windowDays
}

function notApplied(c: CampaignRow, reason: string): EvaluatorResult {
  return {
    campaign_id: c.id,
    campaign_name: c.name,
    type: c.type,
    applied: false,
    reason,
  }
}

function applied(
  c: CampaignRow,
): Pick<EvaluatorResult, "campaign_id" | "campaign_name" | "type" | "applied"> {
  return {
    campaign_id: c.id,
    campaign_name: c.name,
    type: c.type,
    applied: true,
  }
}

/* ============================================================================
 * Config narrowing helpers (tolerate null/missing fields)
 * ========================================================================== */

function getConfig(c: CampaignRow): Record<string, unknown> {
  return c.config ?? {}
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

/* ============================================================================
 * 11 evaluators
 * ========================================================================== */

// 1. discount — % or fixed off scope (all / specific_categories)
export async function evalDiscount(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const method = asString(cfg.discount_method)
  const value = asNumber(cfg.discount_value)
  const scope = asString(cfg.scope)
  const categorySlug = asString(cfg.category_slug)

  if (method !== "percent" && method !== "fixed") {
    return notApplied(c, "config.discount_method 缺失或非法")
  }
  if (value === undefined) {
    return notApplied(c, "config.discount_value 缺失或非法")
  }
  // Audit M2 (round 2): bounds check on value to prevent admin typo
  // exploits (negative value = price increase; >100% percent = free or
  // negative).
  if (value < 0) {
    return notApplied(c, "config.discount_value 不可為負")
  }
  if (method === "percent" && value > 100) {
    return notApplied(c, "config.discount_value 不可超過 100")
  }
  if (!scope) {
    return notApplied(c, "config.scope 缺失")
  }

  const items = await resolveScopeItems(scope, categorySlug, ctx.cart.items)
  if (items.length === 0) return notApplied(c, "scope 內無商品")

  const sub = sumItems(items)
  // Defensive: a percent value in (0,1) is almost certainly a 折-multiplier
  // (e.g. 0.95 = 95折 = 5% off) mistakenly stored instead of a whole percent.
  // Treat it as such so it doesn't silently become a 0.95%-off. Whole-number
  // percents (the current data convention) are unaffected.
  const pctValue = method === "percent" && value > 0 && value < 1 ? (1 - value) * 100 : value
  const discount =
    method === "percent"
      ? Math.min(Math.round((sub * pctValue) / 100), sub)
      : Math.min(value, sub)

  return { ...applied(c), discount_amount: discount }
}

// 2. freebie — gift when subtotal hits threshold
export async function evalFreebie(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const minOrder = asNumber(cfg.min_order_amount)
  const giftSku = asString(cfg.gift_sku)
  const giftQty = asNumber(cfg.gift_qty)
  const giftName = asString(cfg.gift_name)

  if (minOrder === undefined) {
    return notApplied(c, "config.min_order_amount 缺失或非法")
  }
  if (!giftSku || giftQty === undefined || giftQty <= 0) {
    return notApplied(c, "config.gift_sku / gift_qty 缺失或非法")
  }
  if (ctx.cart.subtotal < minOrder) {
    return notApplied(c, "subtotal 未達門檻")
  }

  // Fetch gift retail price so pickBestPerType can score 同 type 多 freebie
  // 競爭時用實際價值決勝負（audit H1/H2 — 之前不寫 unit_price 全部以 0 分
  // 平手，第一筆任意勝出）。Use sale_price 如果有設，否則 price。
  let unitPrice = 0
  try {
    const { data: variant } = await supabase
      .from("product_variants")
      .select("price, sale_price")
      .eq("sku", giftSku)
      .maybeSingle()
    if (variant) {
      const v = variant as { price: number | string | null; sale_price: number | string | null }
      // Audit L1 (round 2): sale_price=0 is treated as "no sale" rather
      // than "free freebie" — fall back to price when sale_price <= 0.
      const sale = Number(v.sale_price ?? 0)
      const regular = Number(v.price ?? 0)
      unitPrice = sale > 0 ? sale : regular
    }
  } catch (err) {
    // Audit M1 (round 2): log so silent freebie-fetch failures are
    // observable (pickBestPerType still tiebreaks via deterministic
    // sort below).
    console.warn(
      `[evalFreebie] product_variants lookup failed for gift_sku=${giftSku}:`,
      err,
    )
  }

  return {
    ...applied(c),
    free_items: [{ sku: giftSku, qty: giftQty, name: giftName, unit_price: unitPrice }],
  }
}

// 3. points_multiplier — does not affect checkout total; affects grantPoints
export async function evalPointsMultiplier(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const multiplier = asNumber(cfg.multiplier)
  const scope = asString(cfg.scope)
  const categorySlug = asString(cfg.category_slug)

  if (multiplier === undefined || multiplier <= 0) {
    return notApplied(c, "config.multiplier 缺失或非法")
  }
  if (!scope) {
    return notApplied(c, "config.scope 缺失")
  }

  const items = await resolveScopeItems(scope, categorySlug, ctx.cart.items)
  if (items.length === 0) return notApplied(c, "scope 內無商品")

  return { ...applied(c), rebate_multiplier: multiplier }
}

// 4. free_shipping — zero out shipping fee when subtotal hits threshold
export function evalFreeShipping(
  c: CampaignRow,
  ctx: EvaluatorContext,
): EvaluatorResult {
  const cfg = getConfig(c)
  const minOrder = asNumber(cfg.min_order_amount)
  if (minOrder === undefined) {
    return notApplied(c, "config.min_order_amount 缺失或非法")
  }
  if (ctx.cart.subtotal < minOrder) {
    return notApplied(c, "subtotal 未達門檻")
  }
  return { ...applied(c), zero_shipping: true }
}

// 5. bundle — whole-cart "buy N, get M free" (cheapest/most expensive units)
export function evalBundle(
  c: CampaignRow,
  ctx: EvaluatorContext,
): EvaluatorResult {
  const cfg = getConfig(c)
  const buyQty = asNumber(cfg.buy_quantity)
  const freeQty = asNumber(cfg.free_quantity)
  const rule = asString(cfg.free_item_rule)

  if (buyQty === undefined || buyQty <= 0) {
    return notApplied(c, "config.buy_quantity 缺失或非法")
  }
  if (freeQty === undefined || freeQty <= 0) {
    return notApplied(c, "config.free_quantity 缺失或非法")
  }
  if (rule !== "lowest_price" && rule !== "highest_price") {
    return notApplied(c, "config.free_item_rule 必須為 lowest_price 或 highest_price")
  }

  const totalQty = ctx.cart.items.reduce((s, i) => s + i.qty, 0)
  if (totalQty < buyQty + freeQty) {
    return notApplied(c, `總件數 ${totalQty} < ${buyQty + freeQty}（需 ${buyQty} 件購買 + ${freeQty} 件贈送）`)
  }

  const units = explodeUnits(ctx.cart.items)
  const sorted =
    rule === "highest_price"
      ? units.sort((a, b) => b.unit_price - a.unit_price)
      : units.sort((a, b) => a.unit_price - b.unit_price)
  const freed = sorted.slice(0, freeQty)
  const discount = freed.reduce((s, u) => s + u.unit_price, 0)

  return { ...applied(c), discount_amount: discount }
}

// 6. buy_x_get_y — scope-bound "buy X, get Y free", repeated up to max_uses_per_order
export async function evalBuyXGetY(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const buyQty = asNumber(cfg.buy_quantity)
  const getQty = asNumber(cfg.get_quantity)
  const scope = asString(cfg.scope)
  const categorySlug = asString(cfg.category_slug)
  const rule = asString(cfg.free_item_rule)
  const maxUses = asNumber(cfg.max_uses_per_order)

  if (buyQty === undefined || buyQty <= 0) {
    return notApplied(c, "config.buy_quantity 缺失或非法")
  }
  if (getQty === undefined || getQty <= 0) {
    return notApplied(c, "config.get_quantity 缺失或非法")
  }
  // Audit L3 (round 2): negative max_uses_per_order produced negative
  // array slice indices and unbounded freebies.
  if (maxUses !== undefined && maxUses < 0) {
    return notApplied(c, "config.max_uses_per_order 不可為負")
  }
  if (!scope) {
    return notApplied(c, "config.scope 缺失")
  }
  if (rule !== "lowest_price" && rule !== "highest_price") {
    return notApplied(c, "config.free_item_rule 必須為 lowest_price 或 highest_price")
  }

  const sameItemOnly = cfg.same_item_only === true || cfg.same_item_only === "true"
  const items = await resolveScopeItems(scope, categorySlug, ctx.cart.items)

  // How many "buy X + get Y" groups the cart qualifies for, and which units are
  // eligible to be given free. When same_item_only (限同品項) is set, 買 X 與 送 Y
  // 必須來自同一個商品 (product_id): each product qualifies on its OWN quantity and
  // only that product's units can be freed — so 1×A + 1×B never combine into a
  // group. When it is NOT set, quantities aggregate across the whole scope.
  let totalUses: number
  let freeablePool: CartItem[]
  if (sameItemOnly) {
    const byProduct = new Map<string, CartItem[]>()
    for (const i of items) {
      const arr = byProduct.get(i.product_id) ?? []
      arr.push(i)
      byProduct.set(i.product_id, arr)
    }
    let usesSum = 0
    freeablePool = []
    for (const group of byProduct.values()) {
      const groupQty = group.reduce((s, i) => s + i.qty, 0)
      const groupUses = Math.floor(groupQty / (buyQty + getQty))
      if (groupUses === 0) continue
      usesSum += groupUses
      // Only this product's own units (its cheapest/dearest groupUses*getQty) are
      // freeable — never another product's.
      const groupUnits = explodeUnits(group)
      const groupSorted =
        rule === "highest_price"
          ? groupUnits.sort((a, b) => b.unit_price - a.unit_price)
          : groupUnits.sort((a, b) => a.unit_price - b.unit_price)
      freeablePool.push(...groupSorted.slice(0, groupUses * getQty))
    }
    totalUses = Math.min(usesSum, maxUses ?? 999)
  } else {
    const scopeQty = items.reduce((s, i) => s + i.qty, 0)
    totalUses = Math.min(Math.floor(scopeQty / (buyQty + getQty)), maxUses ?? 999)
    freeablePool = explodeUnits(items)
  }

  if (totalUses === 0) {
    return notApplied(
      c,
      sameItemOnly ? "無單一商品湊足 1 組（限同品項）" : "scope 件數不足 1 組",
    )
  }

  const totalFreeUnits = totalUses * getQty
  const sorted =
    rule === "highest_price"
      ? freeablePool.sort((a, b) => b.unit_price - a.unit_price)
      : freeablePool.sort((a, b) => a.unit_price - b.unit_price)
  const freed = sorted.slice(0, totalFreeUnits)
  const discount = freed.reduce((s, u) => s + u.unit_price, 0)

  return { ...applied(c), discount_amount: discount }
}

// 7. second_half_price — pair up scope items, discount the cheaper of each pair
export async function evalSecondHalfPrice(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const discountPercent = asNumber(cfg.discount_percent)
  const scope = asString(cfg.scope)
  const categorySlug = asString(cfg.category_slug)
  const maxPairs = asNumber(cfg.max_pairs)

  if (discountPercent === undefined || discountPercent < 0 || discountPercent > 100) {
    return notApplied(c, "config.discount_percent 缺失或非法")
  }
  if (!scope) {
    return notApplied(c, "config.scope 缺失")
  }

  const items = await resolveScopeItems(scope, categorySlug, ctx.cart.items)
  const units = explodeUnits(items).sort((a, b) => a.unit_price - b.unit_price)
  const possiblePairs = Math.floor(units.length / 2)
  const pairs = Math.min(possiblePairs, maxPairs ?? 999)
  if (pairs === 0) {
    return notApplied(c, `scope 件數 ${units.length} 不足 1 對`)
  }

  let discount = 0
  for (let i = 0; i < pairs; i++) {
    discount += (units[i * 2].unit_price * discountPercent) / 100
  }

  return { ...applied(c), discount_amount: Math.round(discount) }
}

// 8. spend_threshold — fixed amount off when subtotal hits threshold
export function evalSpendThreshold(
  c: CampaignRow,
  ctx: EvaluatorContext,
): EvaluatorResult {
  const cfg = getConfig(c)
  const minAmount = asNumber(cfg.min_amount)
  const discountAmount = asNumber(cfg.discount_amount)

  if (minAmount === undefined) {
    return notApplied(c, "config.min_amount 缺失或非法")
  }
  if (discountAmount === undefined || discountAmount <= 0) {
    return notApplied(c, "config.discount_amount 缺失或非法")
  }
  if (ctx.cart.subtotal < minAmount) {
    return notApplied(c, "subtotal 未達門檻")
  }

  const discount = Math.min(discountAmount, ctx.cart.subtotal)
  return { ...applied(c), discount_amount: discount }
}

// 9. tier_upgrade_bonus — fires via upgradeTierIfNeeded; never applies in checkout
export function evalTierUpgradeBonus(
  c: CampaignRow,
  _ctx: EvaluatorContext,
): EvaluatorResult {
  return notApplied(
    c,
    "tier_upgrade_bonus 由 upgradeTierIfNeeded 觸發，不在 checkout",
  )
}

// 10. combo_discount — % off when picking N items from scope
export async function evalComboDiscount(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const minItems = asNumber(cfg.min_items)
  const discountPercent = asNumber(cfg.discount_percent)
  const scope = asString(cfg.scope)
  const categorySlug = asString(cfg.category_slug)

  if (minItems === undefined || minItems <= 0) {
    return notApplied(c, "config.min_items 缺失或非法")
  }
  if (discountPercent === undefined || discountPercent < 0 || discountPercent > 100) {
    return notApplied(c, "config.discount_percent 缺失或非法")
  }
  if (!scope) {
    return notApplied(c, "config.scope 缺失")
  }

  const items = await resolveScopeItems(scope, categorySlug, ctx.cart.items)
  const scopeQty = items.reduce((s, i) => s + i.qty, 0)
  if (scopeQty < minItems) {
    return notApplied(c, `scope 件數 ${scopeQty} < ${minItems}`)
  }

  const sub = sumItems(items)
  const discount = Math.round((sub * discountPercent) / 100)
  return { ...applied(c), discount_amount: discount }
}

// 11. birthday_bonus — % or fixed off + optional rebate multiplier within birthday window
export function evalBirthdayBonus(
  c: CampaignRow,
  ctx: EvaluatorContext,
  now: Date = new Date(),
): EvaluatorResult {
  const cfg = getConfig(c)
  const method = asString(cfg.discount_method)
  const value = asNumber(cfg.discount_value)
  const rebateMultiplier = asNumber(cfg.rebate_multiplier)
  const windowDays = asNumber(cfg.birthday_window_days)

  if (method !== "percent" && method !== "fixed") {
    return notApplied(c, "config.discount_method 缺失或非法")
  }
  if (value === undefined) {
    return notApplied(c, "config.discount_value 缺失或非法")
  }
  if (windowDays === undefined || windowDays <= 0) {
    return notApplied(c, "config.birthday_window_days 缺失或非法")
  }
  if (!ctx.user.birthday) {
    return notApplied(c, "顧客無生日資料")
  }
  if (!isInBirthdayWindow(ctx.user.birthday, windowDays, now)) {
    return notApplied(c, "不在生日當月 window 內")
  }

  // Same 折-multiplier guard as evalDiscount: a percent value in (0,1) means
  // 95折 (=5% off), not 0.95% off. Whole-number percents unaffected.
  const pctValue = method === "percent" && value > 0 && value < 1 ? (1 - value) * 100 : value
  const discount =
    method === "percent"
      ? Math.min(Math.round((ctx.cart.subtotal * pctValue) / 100), ctx.cart.subtotal)
      : Math.min(value, ctx.cart.subtotal)

  const result: EvaluatorResult = {
    ...applied(c),
    discount_amount: discount,
  }
  if (rebateMultiplier !== undefined && rebateMultiplier > 0) {
    result.rebate_multiplier = rebateMultiplier
  }
  return result
}

// 12. first_purchase — fixed discount for users with no prior paid orders
export async function evalFirstPurchase(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const discountAmount = asNumber(cfg.discount_amount) ?? 50
  const minOrderAmount = asNumber(cfg.min_order_amount) ?? 0
  const daysSinceSignup = asNumber(cfg.days_since_signup) // optional

  // 1) Subtotal threshold
  if (ctx.cart.subtotal < minOrderAmount) {
    return notApplied(c, `未達最低訂單金額 NT$${minOrderAmount}`)
  }

  // 2) First-purchase check — sandbox can override; else hit DB
  const isFirst =
    typeof ctx.user._is_first_purchase_override === "boolean"
      ? ctx.user._is_first_purchase_override
      : await isFirstPurchase(ctx.user.id)
  if (!isFirst) return notApplied(c, "不是首購")

  // 3) Optional signup-window check
  if (daysSinceSignup && ctx.user.created_at) {
    const daysAgo =
      (Date.now() - new Date(ctx.user.created_at).getTime()) / 86_400_000
    if (daysAgo > daysSinceSignup) {
      return notApplied(c, `超過註冊後 ${daysSinceSignup} 天`)
    }
  }

  const discount = Math.min(discountAmount, ctx.cart.subtotal)
  return { ...applied(c), discount_amount: discount }
}

/* ============================================================================
 * Dispatcher
 * ========================================================================== */

export async function evaluateCampaign(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  switch (c.type) {
    case "discount":
      return evalDiscount(c, ctx)
    case "freebie":
      return evalFreebie(c, ctx)
    case "points_multiplier":
      return evalPointsMultiplier(c, ctx)
    case "free_shipping":
      return evalFreeShipping(c, ctx)
    case "bundle":
      return evalBundle(c, ctx)
    case "buy_x_get_y":
      return evalBuyXGetY(c, ctx)
    case "second_half_price":
      return evalSecondHalfPrice(c, ctx)
    case "spend_threshold":
      return evalSpendThreshold(c, ctx)
    case "tier_upgrade_bonus":
      return evalTierUpgradeBonus(c, ctx)
    case "combo_discount":
      return evalComboDiscount(c, ctx)
    case "birthday_bonus":
      return evalBirthdayBonus(c, ctx)
    case "first_purchase":
      return evalFirstPurchase(c, ctx)
    default:
      return notApplied(c, `未知的 campaign type: ${c.type}`)
  }
}

/* ============================================================================
 * Orchestrator
 * ========================================================================== */

export async function fetchActiveCampaignsForUser(
  _userId: string,
  tierId: string | null,
): Promise<CampaignRow[]> {
  const now = new Date().toISOString()
  const tierFilter = tierId
    ? `tier_id.is.null,tier_id.eq.${tierId}`
    : "tier_id.is.null"

  const { data } = await supabase
    .from("campaigns")
    .select("*")
    .eq("is_active", true)
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .or(tierFilter)

  return (data ?? []) as CampaignRow[]
}

function scoreForType(r: EvaluatorResult, ctx: EvaluatorContext): number {
  switch (r.type) {
    case "points_multiplier":
      return r.rebate_multiplier ?? 0
    case "freebie":
      return (r.free_items ?? []).reduce(
        (s, fi) => s + (fi.unit_price ?? 0) * (fi.qty ?? 0),
        0,
      )
    case "free_shipping":
      return r.zero_shipping ? ctx.cart.shipping_fee : 0
    default:
      return r.discount_amount ?? 0
  }
}

export function pickBestPerType(
  results: EvaluatorResult[],
  ctx: EvaluatorContext,
): EvaluatorResult[] {
  // Audit L7 (round 2): when two same-type campaigns score equally,
  // iteration order decides the winner non-deterministically. Sort by
  // campaign_id as the secondary key so the outcome is stable across
  // calls and reproducible in tests.
  const sorted = [...results].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type)
    const scoreDiff = scoreForType(b, ctx) - scoreForType(a, ctx)
    if (scoreDiff !== 0) return scoreDiff
    return a.campaign_id.localeCompare(b.campaign_id)
  })
  const byType = new Map<string, EvaluatorResult>()
  for (const r of sorted) {
    if (!byType.has(r.type)) byType.set(r.type, r)
  }
  return Array.from(byType.values())
}

export async function evaluateAllCampaigns(
  ctx: EvaluatorContext,
): Promise<EvaluatorResult[]> {
  const active = await fetchActiveCampaignsForUser(ctx.user.id, ctx.user.tier_id)
  const results = await Promise.all(active.map((c) => evaluateCampaign(c, ctx)))
  return pickBestPerType(results.filter((r) => r.applied), ctx)
}
