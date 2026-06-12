import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { computeShipping } from "../lib/shipping"
import {
  evaluateCampaign,
  fetchActiveCampaignsForUser,
  pickBestPerType,
  type CartItem,
  type EvaluatorContext,
  type EvaluatorResult,
} from "../lib/campaigns-evaluator"

export const campaignsRouter = Router()

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const campaignCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  tier_id: z.string().uuid().optional().nullable(),
  type: z.enum(["discount", "freebie", "points_multiplier", "free_shipping", "bundle", "buy_x_get_y", "second_half_price", "spend_threshold", "tier_upgrade_bonus", "combo_discount", "birthday_bonus", "first_purchase"]),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  coupon_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional().nullable(),
})

const campaignUpdateSchema = campaignCreateSchema.partial()

// ---------------------------------------------------------------------------
// GET /admin/campaigns — list all campaigns (admin/editor)
// ---------------------------------------------------------------------------

campaignsRouter.get("/admin/campaigns", requireAuth, requireEditor, async (_req, res) => {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, membership_tiers(name), coupons(code)")
    .order("created_at", { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})

// ---------------------------------------------------------------------------
// GET /admin/campaigns/:id — single campaign detail (admin/editor)
// ---------------------------------------------------------------------------

campaignsRouter.get("/admin/campaigns/:id", requireAuth, requireEditor, async (req, res) => {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, membership_tiers(name), coupons(code)")
    .eq("id", req.params.id)
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Campaign not found" }); return }
  res.json({ data })
})

// ---------------------------------------------------------------------------
// POST /admin/campaigns — create campaign (admin only)
// ---------------------------------------------------------------------------

campaignsRouter.post("/admin/campaigns", requireAuth, requireAdmin, async (req, res) => {
  const parsed = campaignCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("campaigns")
    .insert(parsed.data)
    .select("*, membership_tiers(name), coupons(code)")
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// ---------------------------------------------------------------------------
// PUT /admin/campaigns/:id — update campaign (admin only)
// ---------------------------------------------------------------------------

campaignsRouter.put("/admin/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = campaignUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("campaigns")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select("*, membership_tiers(name), coupons(code)")
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Campaign not found" }); return }
  res.json({ data })
})

// ---------------------------------------------------------------------------
// DELETE /admin/campaigns/:id — delete campaign (admin only)
// ---------------------------------------------------------------------------

campaignsRouter.delete("/admin/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// ---------------------------------------------------------------------------
// POST /admin/campaigns/preview — sandbox/test bench (admin only)
//
// Construct any synthetic checkout scenario (cart, user context, shipping,
// coupon, points) and see how each ACTIVE campaign would respond — applied
// vs not, reason for non-application, discount/free items it would grant.
// Returns BOTH the raw per-campaign evaluator output AND the pickBestPerType
// winners (= what a real order would actually charge).
//
// Read-only: does NOT create orders, deduct stock, or increment coupon
// used_count. Safe to call repeatedly for testing.
// ---------------------------------------------------------------------------

const adminPreviewSchema = z.object({
  items: z.array(z.object({
    variantId: z.string().uuid().optional(),
    sku: z.string().optional(),
    qty: z.number().int().positive(),
    unitPrice: z.number().int().nonnegative().optional(), // cents; if absent we'll read from product_variants.price
  })).min(1),
  shippingMethod: z.enum(["home_delivery", "cvs_711", "cvs_family", "overseas_cod"]).default("home_delivery"),
  // User-context override (any subset; missing fields default to "guest")
  user_id: z.string().uuid().optional(),
  tier_id: z.string().uuid().nullable().optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  has_past_orders: z.boolean().optional(),
  user_created_at: z.string().datetime().optional(),
  coupon_code: z.string().optional(),
  points_used: z.number().int().nonnegative().optional(),
})

campaignsRouter.post("/admin/campaigns/preview", requireAuth, requireAdmin, async (req, res) => {
  const parsed = adminPreviewSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }
  const p = parsed.data

  // ───── 1. Build cart items ─────
  // Need product_variants rows to get category_id (for scope-matching) +
  // fallback unit_price when admin didn't specify one.
  type VRow = {
    id: string
    sku: string | null
    name: string
    price: number | string
    product_id: string
    products: { category_id: string | null; name: string | null } | null
  }
  const wantVariantIds = p.items.filter(i => i.variantId).map(i => i.variantId as string)
  const wantSkus = p.items.filter(i => !i.variantId && i.sku).map(i => i.sku as string)

  const variantMap = new Map<string, VRow>()
  const skuMap = new Map<string, VRow>()

  if (wantVariantIds.length) {
    const { data } = await supabase
      .from("product_variants")
      .select("id, sku, name, price, product_id, products(category_id, name)")
      .in("id", wantVariantIds)
    for (const r of (data ?? []) as unknown as VRow[]) variantMap.set(r.id, r)
  }
  if (wantSkus.length) {
    const { data } = await supabase
      .from("product_variants")
      .select("id, sku, name, price, product_id, products(category_id, name)")
      .in("sku", wantSkus)
    for (const r of (data ?? []) as unknown as VRow[]) {
      if (r.sku) skuMap.set(r.sku, r)
      variantMap.set(r.id, r)
    }
  }

  const cartItems: CartItem[] = []
  const resolved: { variant_id: string; sku: string | null; name: string; unit_price_cents: number; qty: number }[] = []
  for (const item of p.items) {
    const v = item.variantId ? variantMap.get(item.variantId) : (item.sku ? skuMap.get(item.sku) : null)
    if (!v) continue
    const dbPriceCents = Math.round(Number(v.price) * 100)
    const priceCents = item.unitPrice ?? dbPriceCents
    cartItems.push({
      product_id: v.product_id,
      variant_id: v.id,
      category_id: v.products?.category_id ?? null,
      sku: v.sku,
      name: v.products?.name ?? v.name,
      unit_price: priceCents / 100,
      qty: item.qty,
    })
    resolved.push({
      variant_id: v.id,
      sku: v.sku,
      name: v.products?.name ?? v.name,
      unit_price_cents: priceCents,
      qty: item.qty,
    })
  }
  if (cartItems.length === 0) {
    res.status(400).json({ error: "No items could be resolved (check variantId/sku)" })
    return
  }

  const subtotalCents = cartItems.reduce((s, i) => s + Math.round(i.unit_price * 100) * i.qty, 0)

  // ───── 2. Build user context (impersonation merged with overrides) ─────
  let profileTierId: string | null = null
  let profileBirthday: string | null = null
  let profileCreatedAt: string | null = null
  if (p.user_id) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("membership_tier_id, birthday, created_at")
      .eq("user_id", p.user_id)
      .maybeSingle()
    if (profile) {
      const pf = profile as { membership_tier_id: string | null; birthday: string | null; created_at: string | null }
      profileTierId = pf.membership_tier_id
      profileBirthday = pf.birthday
      profileCreatedAt = pf.created_at
    }
  }

  // Explicit override wins over impersonation
  const tierId = p.tier_id !== undefined ? p.tier_id : profileTierId
  const birthday = p.birthday !== undefined ? p.birthday : profileBirthday
  const createdAt = p.user_created_at ?? profileCreatedAt ?? null

  // ───── 3. Compute shipping fee ─────
  const feeDollars = await computeShipping(p.shippingMethod, subtotalCents / 100)
  let shippingFeeCents = Math.round(feeDollars * 100)

  // ───── 4. Build EvaluatorContext + run every active campaign ─────
  const ctx: EvaluatorContext = {
    user: {
      id: p.user_id ?? "",
      tier_id: tierId ?? null,
      birthday: birthday ?? null,
      created_at: createdAt,
      _is_first_purchase_override: p.has_past_orders === undefined ? undefined : !p.has_past_orders,
    },
    cart: {
      items: cartItems,
      subtotal: subtotalCents / 100,
      shipping_fee: shippingFeeCents / 100,
    },
  }

  const activeCampaigns = await fetchActiveCampaignsForUser(ctx.user.id, ctx.user.tier_id)
  const allResults = await Promise.all(activeCampaigns.map(c => evaluateCampaign(c, ctx)))

  // pickBestPerType applies on the APPLIED subset
  const appliedWinners = pickBestPerType(allResults.filter(r => r.applied), ctx)
  const winnerIds = new Set(appliedWinners.map(w => w.campaign_id))

  // Mark each result with would_be_used (won pickBest) for UI clarity
  const verbose = allResults.map(r => ({
    ...r,
    would_be_used: r.applied && winnerIds.has(r.campaign_id),
    overridden_by_stacking: r.applied && !winnerIds.has(r.campaign_id),
  }))

  // ───── 5. Calculate breakdown using winners (mirror /orders/preview math) ─────
  let campaignDiscountCents = 0
  for (const r of appliedWinners) {
    if (r.discount_amount) campaignDiscountCents += Math.round(r.discount_amount * 100)
    if (r.zero_shipping) shippingFeeCents = 0
  }

  // ───── 6. Coupon (read-only validate, no atomic_increment) ─────
  let couponDiscountCents = 0
  let couponInfo: { code: string; type: string; value: number; applied: boolean; reason?: string } | null = null
  if (p.coupon_code) {
    const { data: coupon } = await supabase
      .from("coupons")
      .select("id, code, type, value, min_order, max_uses, used_count, expires_at, tier_id")
      .eq("code", p.coupon_code)
      .maybeSingle()
    if (!coupon) {
      couponInfo = { code: p.coupon_code, type: "?", value: 0, applied: false, reason: "查無此優惠碼" }
    } else {
      const c = coupon as unknown as { code: string; type: string; value: number; min_order: number | null; max_uses: number | null; used_count: number; expires_at: string | null; tier_id: string | null }
      const now = new Date()
      const reasons: string[] = []
      if (c.expires_at && new Date(c.expires_at) < now) reasons.push("已過期")
      if (c.min_order != null && subtotalCents < c.min_order) reasons.push(`未達最低訂單 NT$${Math.round(c.min_order / 100)}`)
      if (c.max_uses != null && c.used_count >= c.max_uses) reasons.push("已用罄")
      if (c.tier_id && c.tier_id !== tierId) reasons.push("與 tier 不符")
      if (reasons.length > 0) {
        couponInfo = { code: c.code, type: c.type, value: Number(c.value), applied: false, reason: reasons.join("；") }
      } else {
        const baseAfterCampaigns = Math.max(0, subtotalCents - campaignDiscountCents)
        if (c.type === "percentage") {
          couponDiscountCents = Math.round(baseAfterCampaigns * (Number(c.value) / 100))
        } else if (c.type === "fixed") {
          // c.value is TWD dollars; admin-preview math is in cents → ×100.
          couponDiscountCents = Math.min(baseAfterCampaigns, Math.round(Number(c.value) * 100))
        } else if (c.type === "free_shipping") {
          shippingFeeCents = 0
        }
        couponInfo = { code: c.code, type: c.type, value: Number(c.value), applied: true }
      }
    }
  }

  // ───── 7. Points (simple linear deduction; sandbox only) ─────
  let pointsDiscountCents = 0
  if (p.points_used && p.points_used > 0) {
    // 1pt = NT$1 default (matches points.ratio sane default; admin can adjust live in settings)
    pointsDiscountCents = Math.min(
      Math.max(0, subtotalCents - campaignDiscountCents - couponDiscountCents),
      p.points_used * 100,
    )
  }

  const totalCents = Math.max(0, subtotalCents + shippingFeeCents - campaignDiscountCents - couponDiscountCents - pointsDiscountCents)

  res.json({
    data: {
      resolved_items: resolved,
      breakdown: {
        subtotal: subtotalCents / 100,
        shipping: shippingFeeCents / 100,
        campaign_discount: campaignDiscountCents / 100,
        coupon_discount: couponDiscountCents / 100,
        points_discount: pointsDiscountCents / 100,
        total: totalCents / 100,
      },
      campaigns: verbose,
      applied_winners: appliedWinners.map(w => ({ campaign_id: w.campaign_id, campaign_name: w.campaign_name, type: w.type })),
      coupon: couponInfo,
      ctx_summary: {
        user_id: ctx.user.id || null,
        tier_id: ctx.user.tier_id,
        birthday: ctx.user.birthday,
        created_at: ctx.user.created_at,
        first_purchase_override: p.has_past_orders === undefined ? "auto (from DB)" : (p.has_past_orders ? "假裝有過去訂單" : "假裝首購"),
      },
    },
  })
})

// ---------------------------------------------------------------------------
// GET /campaigns/active — public, list currently active campaigns
// ---------------------------------------------------------------------------

campaignsRouter.get("/campaigns/active", async (_req, res) => {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("campaigns")
    .select("*, membership_tiers(name)")
    .eq("is_active", true)
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("starts_at", { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})
