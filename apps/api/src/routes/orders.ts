import { Router } from "express"
import { randomBytes } from "crypto"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth, optionalAuth } from "../middleware/auth"
import { idempotencyMiddleware } from "../middleware/idempotency"
import { getMemberDiscountRate } from "../lib/tier"
import {
  evaluateAllCampaigns,
  type CartItem,
  type EvaluatorContext,
  type FreeItem,
} from "../lib/campaigns-evaluator"
import { createPayment as pchomepayCreatePayment } from "../lib/pchomepay"
import { requestPayment as linePayRequestPayment } from "../lib/linepay"
import { initiatePayment as jkoPayInitiatePayment } from "../lib/jkopay"
import { getApiBaseUrl, getSiteUrl } from "../lib/urls"
import { computeShipping, getShippingRule } from "../lib/shipping"
import { inventoryQueue } from "../lib/queue"
import { enqueuePostPaymentJobs } from "../lib/enqueue-post-payment"
import {
  calcPointsDiscount,
  getEffectiveRedeemablePoints,
  loadPointsSettings,
  type CartForPoints,
} from "../lib/points"

export const ordersRouter = Router()

function centsToTwd(cents: number): number {
  return Math.round(cents) / 100
}

const orderItemSchema = z.object({
  variantId: z.string().uuid(),
  qty: z.number().int().positive(),
  unitPrice: z.number().int().positive(),
  productName: z.string().optional(),
  variantName: z.string().optional(),
})

const addressSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),          // 從 regex(/^09\d{8}$/) 改為 min(1)，海外地址支援國際電話
  addressType: z.enum(["home", "cvs", "overseas"]),  // 新增 "overseas"
  address: z.string().optional(),
  city: z.string().optional(),
  district: z.string().optional(),   // 鄉鎮市區 — 先前整路遺失，宅配地址不完整
  postalCode: z.string().optional(),
  cvsStoreId: z.string().optional(),
  cvsType: z.string().optional(),
  country: z.string().optional(),    // 新增 country 欄位
})

// Electronic invoice selection (InvoiceSelector). Persisted on the order and
// read by the post-payment pipeline so B2B/載具/愛心碼 actually issue correctly
// instead of everyone getting a default B2C_2.
const invoiceSchema = z.object({
  type: z.enum(["B2C_2", "B2C_3", "B2B"]),
  carrierType: z.enum(["phone", "natural_person", "love_code"]).optional(),
  carrierNumber: z.string().optional(),
  loveCode: z.string().optional(),
  taxId: z.string().optional(),
  companyTitle: z.string().optional(),
}).refine((v) => v.type !== "B2B" || (v.taxId && /^\d{8}$/.test(v.taxId)), {
  message: "B2B 發票需要 8 碼統一編號",
  path: ["taxId"],
})

const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  address: addressSchema,
  shippingMethod: z.enum(["home_delivery", "cvs_711", "cvs_family", "overseas_cod"]),  // 新增
  paymentMethod: z.enum(["pchomepay", "linepay", "jkopay", "cvs_cod", "test_paid"]),  // test_paid = admin sandbox (skips gateway)
  guestEmail: z.string().email().optional(),
  couponCode: z.string().optional(),
  points_used: z.number().int().min(0).optional(),
  invoice: invoiceSchema.optional(),
})

// POST /orders/preview — price-only preview (subtotal + campaigns + total).
// No order is created, no inventory locked. Frontend calls on cart/shipping
// change so the checkout summary can show 首購折抵 / 滿額贈品 / 等活動 lines
// BEFORE the user pays. Spec R Section 1.
//
// optionalAuth: logged-in users get campaign eval with their user_id (enables
// first_purchase / birthday / tier-specific campaigns). Guests get the
// "no user_id" path (most campaigns still fire on cart-level conditions).
ordersRouter.post("/preview", optionalAuth, async (req, res) => {
  const previewSchema = z.object({
    items: z.array(orderItemSchema).min(1),
    shippingMethod: z.enum(["home_delivery", "cvs_711", "cvs_family", "overseas_cod"]).default("home_delivery"),  // 新增 overseas_cod
    paymentMethodHint: z.string().optional(),
    couponCode: z.string().optional(),
    points_used: z.number().int().min(0).optional(),
  })
  const parsed = previewSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }
  const { items, shippingMethod, paymentMethodHint } = parsed.data
  let { couponCode } = parsed.data
  const previewPointsUsed = parsed.data.points_used ?? 0
  const userId: string | undefined = res.locals.userId

  // KOL coupon override — mirrors POST / so /preview shows the correct
  // discounted price when a kol_ref cookie is set. Audit (H17).
  const kolRefCookie = req.cookies?.kol_ref
  if (kolRefCookie && /^[a-z0-9-]+$/.test(kolRefCookie)) {
    const { data: kol } = await supabase
      .from("kols")
      .select("coupon_id, is_active")
      .eq("slug", kolRefCookie)
      .eq("is_active", true)
      .maybeSingle()
    if (kol?.coupon_id) {
      const { data: kolCoupon } = await supabase
        .from("coupons")
        .select("code")
        .eq("id", kol.coupon_id)
        .maybeSingle()
      if (kolCoupon?.code) couponCode = kolCoupon.code as string
    }
  }

  // Price from the catalog (sale_price ?? price), not the client — keeps the
  // previewed total equal to what POST /orders will actually charge. Graceful:
  // an unknown variant falls back to the client price (preview is display-only;
  // create-order is the strict authority).
  const variantIds = items.map((i) => i.variantId)
  const { data: variantRows } = await supabase
    .from("product_variants")
    .select("id, sku, name, price, sale_price, product_id, products(category_id, name)")
    .in("id", variantIds)
  type VariantRow = {
    id: string
    sku: string | null
    name: string
    price: number | string | null
    sale_price: number | string | null
    product_id: string
    products: { category_id: string | null; name: string | null } | null
  }
  const variantMap = new Map<string, VariantRow>()
  for (const row of (variantRows ?? []) as unknown as VariantRow[]) variantMap.set(row.id, row)
  function unitPriceCents(item: { variantId: string; unitPrice: number }): number {
    const v = variantMap.get(item.variantId)
    if (!v) return item.unitPrice
    return Math.round(Number(v.sale_price ?? v.price ?? 0) * 100)
  }

  const subtotalCents = items.reduce((sum, i) => sum + unitPriceCents(i) * i.qty, 0)
  const shippingRule = await getShippingRule(shippingMethod, paymentMethodHint)
  const feeDollars =
    shippingRule.free_threshold > 0 && subtotalCents / 100 >= shippingRule.free_threshold
      ? 0
      : shippingRule.fee
  let shippingFeeCents = Math.round(feeDollars * 100)

  // Fetch user profile fields needed by evaluator (tier, birthday, created_at)
  let profileTierId: string | null = null
  let profileBirthday: string | null = null
  let profileCreatedAt: string | null = null
  if (userId) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("membership_tier_id, birthday, created_at")
      .eq("user_id", userId)
      .maybeSingle()
    if (profile) {
      profileTierId = (profile as { membership_tier_id: string | null }).membership_tier_id
      profileBirthday = (profile as { birthday: string | null }).birthday
      profileCreatedAt = (profile as { created_at: string | null }).created_at
    }
  }

  // Build variant lookup for category_id (campaign scope matching)
  const cartItems: CartItem[] = items.map((item) => {
    const v = variantMap.get(item.variantId)
    return {
      product_id: v?.product_id ?? "",
      variant_id: item.variantId,
      category_id: v?.products?.category_id ?? null,
      sku: v?.sku ?? null,
      name: item.productName ?? v?.products?.name ?? v?.name ?? "",
      unit_price: unitPriceCents(item) / 100,
      qty: item.qty,
    }
  })

  const evaluatorCtx: EvaluatorContext = {
    user: {
      id: userId ?? "",
      tier_id: profileTierId,
      birthday: profileBirthday,
      created_at: profileCreatedAt,
    },
    cart: {
      items: cartItems,
      subtotal: subtotalCents / 100,
      shipping_fee: shippingFeeCents / 100,
    },
  }
  const campaignResults = await evaluateAllCampaigns(evaluatorCtx)

  let campaignDiscountCents = 0
  const freeItems: FreeItem[] = []
  const discounts: Array<{ campaign_id: string; name: string; amount: number; type: string }> = []
  const freeShippingNames: string[] = []
  for (const r of campaignResults) {
    if (!r.applied) continue
    if (r.discount_amount && r.discount_amount > 0) {
      campaignDiscountCents += Math.round(r.discount_amount * 100)
      discounts.push({
        campaign_id: r.campaign_id,
        name: r.campaign_name,
        amount: r.discount_amount,
        type: r.type,
      })
    }
    if (r.free_items?.length) freeItems.push(...r.free_items)
    if (r.zero_shipping) {
      shippingFeeCents = 0
      freeShippingNames.push(r.campaign_name)
    }
  }

  // Member tier discount — mirrors POST / precedence (subtotal → tier →
  // campaign → coupon → points). Audit H15 fix.
  const memberDiscountRate = await getMemberDiscountRate(userId)
  const memberDiscountCents = Math.round(subtotalCents * memberDiscountRate)

  // Coupon — preview validates read-only; does NOT call atomic_increment.
  // Audit H16. Same logic as POST / so the displayed discount matches.
  let couponDiscountCents = 0
  let couponPreviewInfo: { code: string; amount: number } | null = null
  if (couponCode) {
    const { data: coupon } = await supabase
      .from("coupons")
      .select("type, value, min_order, expires_at, max_uses, used_count, tier_id")
      .eq("code", couponCode)
      .maybeSingle()
    const now = new Date()
    // coupon.min_order stored as TWD dollars (NUMERIC(10,2)); subtotalCents
    // is cents — convert (audit H17).
    const minOrderCents = coupon?.min_order != null ? Math.round(Number(coupon.min_order) * 100) : null
    // Coupon tier_id gate (audit H16): if coupon is tier-locked, only the
    // matching tier may apply. Honor in preview too so displayed price matches
    // POST / behaviour.
    const couponTierOk =
      !coupon?.tier_id || (userId != null && profileTierId === coupon.tier_id)
    const usable =
      coupon &&
      (!coupon.expires_at || new Date(coupon.expires_at) >= now) &&
      (minOrderCents == null || subtotalCents >= minOrderCents) &&
      (coupon.max_uses == null || Number(coupon.used_count ?? 0) < coupon.max_uses) &&
      couponTierOk
    // Audit L5 (round 2): if shipping was already zeroed by a free_shipping
    // campaign, applying a free_shipping coupon delivers nothing — same
    // logic as POST / couponWouldBeRedundant.
    const previewCouponRedundant =
      coupon?.type === "free_shipping" && shippingFeeCents === 0
    if (usable && coupon && !previewCouponRedundant) {
      const baseAfter = Math.max(0, subtotalCents - memberDiscountCents - campaignDiscountCents)
      // Audit M4 (round 2): bounds-check coupon value (admin typo guard).
      const rawValue = Number(coupon.value)
      if (Number.isFinite(rawValue) && rawValue >= 0) {
        const clampedPctValue = Math.min(rawValue, 100)
        if (coupon.type === "percentage") {
          couponDiscountCents = Math.round(baseAfter * (clampedPctValue / 100))
        } else if (coupon.type === "fixed") {
          // coupon.value is TWD dollars; preview math is in cents → ×100.
          couponDiscountCents = Math.min(baseAfter, Math.round(rawValue * 100))
        } else if (coupon.type === "free_shipping") {
          // Audit L12 (round 2): report actual shipping savings on the coupon
          // info line so UI can show "免運費 -NT$ X".
          couponDiscountCents = shippingFeeCents
          shippingFeeCents = 0
        }
      }
      couponPreviewInfo = { code: couponCode, amount: couponDiscountCents / 100 }
    }
  }

  // Points discount — preview only (no ledger), but it must enforce the
  // same effective balance rule as POST /orders so the checkout summary
  // cannot preview an impossible discount.
  // Base = subtotal - member - campaign - coupon to match POST / cap math
  // (audit H3 — was previously using raw subtotal as base).
  let pointsDiscountCents = 0
  let appliedPreviewPointsUsed = 0
  let effectivePointsBalance: number | null = null
  if (userId && previewPointsUsed > 0) {
    effectivePointsBalance = await getEffectiveRedeemablePoints(userId)
  }
  if (
    previewPointsUsed > 0 &&
    userId &&
    effectivePointsBalance != null &&
    effectivePointsBalance >= previewPointsUsed
  ) {
    const settings = await loadPointsSettings()
    const baseAfterAllOtherDiscounts = Math.max(
      0,
      subtotalCents - memberDiscountCents - campaignDiscountCents - couponDiscountCents,
    )
    const cart: CartForPoints = {
      subtotal: baseAfterAllOtherDiscounts / 100,
      shipping: shippingFeeCents / 100,
      sale_item_total: 0,
      total: (baseAfterAllOtherDiscounts + shippingFeeCents) / 100,
    }
    const r = calcPointsDiscount(cart, previewPointsUsed, settings)
    if (r.allowed) {
      appliedPreviewPointsUsed = previewPointsUsed
      pointsDiscountCents = Math.round(r.discount * 100)
    }
  }

  const totalDiscountCents =
    memberDiscountCents + campaignDiscountCents + couponDiscountCents + pointsDiscountCents
  const totalCents = Math.max(0, subtotalCents + shippingFeeCents - totalDiscountCents)
  res.json({
    data: {
      subtotal: subtotalCents / 100,
      shipping: shippingFeeCents / 100,
      shipping_rule: shippingRule,
      member_discount: memberDiscountCents / 100,
      campaign_discount: campaignDiscountCents / 100,
      coupon_discount: couponDiscountCents / 100,
      coupon: couponPreviewInfo,
      discount_total: totalDiscountCents / 100,
      discounts,
      free_items: freeItems,
      free_shipping_names: freeShippingNames,
      points_used: appliedPreviewPointsUsed,
      points_discount: pointsDiscountCents / 100,
      points_balance: effectivePointsBalance,
      total: totalCents / 100,
    },
  })
})

// POST /orders — create order from cart items.
// optionalAuth: if a Bearer token is present, the order is linked to that
// user; if absent, the order is created as a guest checkout (user_id=null,
// guest_email used). Either path is fine.
ordersRouter.post("/", optionalAuth, idempotencyMiddleware, async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() }); return
  }

  const { items, address, shippingMethod, paymentMethod, guestEmail, invoice } = parsed.data
  let { couponCode } = parsed.data
  const requestedPointsUsed = parsed.data.points_used ?? 0
  const userId: string | undefined = res.locals.userId

  if (paymentMethod === "test_paid") {
    if (!userId) {
      res.status(401).json({ error: "test_paid requires authentication (請先登入)" })
      return
    }
    if (process.env.ALLOW_NON_ADMIN_TEST_PAID !== "true") {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle()
      if ((profile as { role?: string | null } | null)?.role !== "admin") {
        res.status(403).json({ error: "test_paid is restricted to admins" })
        return
      }
    }
  }

  const orderNumber = "RR" + Date.now() + randomBytes(4).toString("hex")

  // Authoritative pricing — NEVER trust the client's items[].unitPrice. Recompute
  // every line from the catalog so a tampered request (or a stale cart snapshot)
  // can't set the charged amount. Effective price = sale_price ?? price, matching
  // the storefront (apps/web AddToCartSection).
  const variantIds = items.map((i) => i.variantId)
  const { data: variantRows, error: variantErr } = await supabase
    .from("product_variants")
    .select("id, sku, name, price, sale_price, product_id, products(category_id, name)")
    .in("id", variantIds)
  if (variantErr) {
    console.error("[orders] variant price fetch failed:", variantErr)
    res.status(500).json({ error: "讀取商品資料失敗" }); return
  }
  type VariantRow = {
    id: string
    sku: string | null
    name: string
    price: number | string | null
    sale_price: number | string | null
    product_id: string
    products: { category_id: string | null; name: string | null } | null
  }
  const variantMap = new Map<string, VariantRow>()
  for (const row of (variantRows ?? []) as unknown as VariantRow[]) variantMap.set(row.id, row)
  const missingVariants = variantIds.filter((id) => !variantMap.has(id))
  if (missingVariants.length > 0) {
    res.status(400).json({ error: "商品不存在或已下架", variantIds: missingVariants }); return
  }
  function unitPriceCents(variantId: string): number {
    const v = variantMap.get(variantId)!
    return Math.round(Number(v.sale_price ?? v.price ?? 0) * 100)
  }

  const subtotalCents = items.reduce((sum, i) => sum + unitPriceCents(i.variantId) * i.qty, 0)
  const feeDollars = await computeShipping(shippingMethod, subtotalCents / 100, paymentMethod)
  let shippingFeeCents = Math.round(feeDollars * 100)

  // ---------------------------------------------------------------------------
  // KOL affiliate attribution (Spec I §3)
  //
  // Read kol_ref cookie set by apps/web middleware. If KOL exists + active:
  //   - record attributed_kol_id + attributed_kol_slug on the order
  //   - if KOL has coupon_id linked, override user-typed coupon (KOL priority
  //     per spec locked decision §3.2)
  // ---------------------------------------------------------------------------
  let attributedKolId: string | null = null
  let attributedKolSlug: string | null = null
  const kolRefCookie = req.cookies?.kol_ref
  if (kolRefCookie && /^[a-z0-9-]+$/.test(kolRefCookie)) {
    const { data: kol } = await supabase
      .from("kols")
      // user_id (migration 0037) links a KOL to a user account — needed to
      // detect self-referral below.
      .select("id, slug, coupon_id, is_active, user_id")
      .eq("slug", kolRefCookie)
      .eq("is_active", true)
      .maybeSingle()
    // Self-referral guard (B8): a KOL buying via their own link must NOT earn
    // attribution commission nor get their own KOL coupon force-applied. If the
    // KOL is linked to a user account and that account is the buyer, skip the
    // whole block — leave attributedKolId/Slug null and keep the user's own
    // coupon untouched.
    const isSelfReferral = kol?.user_id != null && userId != null && kol.user_id === userId
    if (kol && !isSelfReferral) {
      attributedKolId = kol.id as string
      attributedKolSlug = kol.slug as string
      if (kol.coupon_id) {
        // KOL coupon takes priority — look up code so coupon validation block below works uniformly.
        const { data: kolCoupon } = await supabase
          .from("coupons")
          .select("code")
          .eq("id", kol.coupon_id)
          .maybeSingle()
        if (kolCoupon?.code) {
          couponCode = kolCoupon.code as string
        }
      }
    }
  }

  // Apply member discount based on membership tier
  const discountRate = await getMemberDiscountRate(userId)
  const memberDiscountCents = Math.round(subtotalCents * discountRate)

  // ---------------------------------------------------------------------------
  // Marketing campaign evaluation (precedence: subtotal → tier → campaigns → coupon → points)
  //
  // Spec: docs/superpowers/specs/2026-05-30-campaigns-evaluator-engine-design.md §3 / Path 1.
  // Cart items need category_id (sourced via product_variants → products join) so
  // category-scoped campaigns (e.g. "凍乾類 9 折") can target them. Profile fetch
  // pulls tier_id + birthday for the EvaluatorContext.
  // ---------------------------------------------------------------------------
  let profileTierId: string | null = null
  let profileBirthday: string | null = null
  let profileCreatedAt: string | null = null
  if (userId) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("membership_tier_id, birthday, created_at")
      .eq("user_id", userId)
      .maybeSingle()
    profileTierId = (profile?.membership_tier_id as string | null) ?? null
    profileBirthday = (profile?.birthday as string | null) ?? null
    profileCreatedAt = (profile?.created_at as string | null) ?? null
  }

  // Cart items for the campaign evaluator — reuse variantMap (built above for
  // authoritative pricing). unit_price is authoritative dollars, not client-supplied.
  const cartItems: CartItem[] = items.map((item) => {
    const v = variantMap.get(item.variantId)
    return {
      product_id: v?.product_id ?? "",
      variant_id: item.variantId,
      category_id: v?.products?.category_id ?? null,
      sku: v?.sku ?? null,
      name: item.productName ?? v?.products?.name ?? v?.name ?? "",
      unit_price: unitPriceCents(item.variantId) / 100,
      qty: item.qty,
    }
  })

  const evaluatorCtx: EvaluatorContext = {
    user: {
      id: userId ?? "",
      tier_id: profileTierId,
      birthday: profileBirthday,
      created_at: profileCreatedAt,
    },
    cart: {
      items: cartItems,
      subtotal: subtotalCents / 100,
      shipping_fee: shippingFeeCents / 100,
    },
  }
  const campaignResults = await evaluateAllCampaigns(evaluatorCtx)

  let campaignDiscountCents = 0
  let shippingZeroedByCampaign = false
  let firstPurchaseApplied = false
  const freeItems: FreeItem[] = []
  for (const r of campaignResults) {
    if (!r.applied) continue
    if (r.discount_amount) {
      campaignDiscountCents += Math.round(r.discount_amount * 100)
    }
    if (r.free_items && r.free_items.length > 0) {
      freeItems.push(...r.free_items)
    }
    if (r.zero_shipping) {
      shippingFeeCents = 0
      shippingZeroedByCampaign = true
    }
    if (r.type === "first_purchase") {
      firstPurchaseApplied = true
    }
  }
  // "preview" sentinel comes from POST /admin/campaigns/preview; real
  // checkout results never carry it, but skip defensively.
  const appliedCampaignIds = campaignResults
    .filter((r) => r.applied)
    .map((r) => r.campaign_id)
    .filter((id) => id !== "preview")

  // Optionally apply a coupon — server-side validation + computation so the
  // client can't forge a discount. Silent skip if invalid (status_code-equivalent
  // detection happens via /coupons/validate before the user reaches checkout).
  let couponDiscountCents = 0
  let appliedCouponId: string | null = null
  if (couponCode) {
    const { data: coupon } = await supabase
      .from("coupons")
      .select("id, type, value, min_order, max_uses, used_count, expires_at, tier_id, is_active")
      .eq("code", couponCode)
      .maybeSingle()
    const now = new Date()
    // coupon.min_order in TWD dollars; subtotalCents in cents (audit H17).
    const minOrderCents = coupon?.min_order != null ? Math.round(Number(coupon.min_order) * 100) : null
    // Coupon tier_id gate (audit H16): tier-locked coupon requires user's
    // profileTierId to match.
    const couponTierOk =
      !coupon?.tier_id || (userId != null && profileTierId === coupon.tier_id)
    const validPrecheck =
      coupon &&
      coupon.is_active !== false && // admin-disabled coupons must not apply
      (!coupon.expires_at || new Date(coupon.expires_at) >= now) &&
      (minOrderCents == null || subtotalCents >= minOrderCents) &&
      couponTierOk
    if (validPrecheck && coupon) {
      // Pre-check redundancy: if shipping is already 0 (zeroed by a
      // free_shipping campaign) and this coupon is type='free_shipping',
      // the coupon would deliver nothing yet still consume used_count.
      // Skip silently so the user can use it on a future order.
      // Audit M3 fix.
      const couponWouldBeRedundant =
        coupon.type === "free_shipping" && shippingFeeCents === 0

      if (couponWouldBeRedundant) {
        // No-op: don't atomic_increment, don't set appliedCouponId.
      } else {
        // Atomically increment used_count; RPC returns false if already at max_uses or expired.
        const incResp = await supabase.rpc("atomic_increment_coupon_usage", { p_coupon_id: coupon.id })
        if (incResp.error || !incResp.data) {
          // Silently skip the coupon — claim race lost or expired.
        } else {
          const baseAfterCampaigns = Math.max(
            0,
            subtotalCents - memberDiscountCents - campaignDiscountCents,
          )
          // Audit M4 (round 2): bounds-check coupon value. Negative or
          // >100% percentage would inflate the order or drive it negative.
          const rawValue = Number(coupon.value)
          if (Number.isFinite(rawValue) && rawValue >= 0) {
            const clampedPctValue = Math.min(rawValue, 100)
            if (coupon.type === "percentage") {
              couponDiscountCents = Math.round(baseAfterCampaigns * (clampedPctValue / 100))
            } else if (coupon.type === "fixed") {
              // coupon.value is TWD dollars; order math is in cents → ×100.
              // (Was applying the dollar figure as cents, so a NT$200 coupon
              // only took NT$2 off while the widget showed the full NT$200.)
              couponDiscountCents = Math.min(baseAfterCampaigns, Math.round(rawValue * 100))
            } else if (coupon.type === "free_shipping") {
              // Don't deduct from items; zero the shipping fee instead.
              shippingFeeCents = 0
            }
          }
          appliedCouponId = coupon.id
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Points redemption — verify balance, recompute discount server-side.
  // We never trust the client's reported discount amount; the client only
  // tells us HOW MANY points to spend, and we compute the NT$ value here.
  // Insufficient balance / invalid → silently fall back to 0 (FE PromoWidget
  // gates on /points/apply which would have shown an error already).
  // -------------------------------------------------------------------------
  let pointsUsed = 0
  let pointsDiscountCents = 0
  if (userId && requestedPointsUsed > 0) {
    const effectiveBalance = await getEffectiveRedeemablePoints(userId)
    if (effectiveBalance >= requestedPointsUsed) {
      const settings = await loadPointsSettings()
      // Spec D precedence: subtotal → tier → campaign → coupon → points.
      // Points cap must use the base AFTER member/campaign/coupon, otherwise
      // a 100%-cap rule lets points cover discounts that already applied
      // (audit H3). E.g. cart 1000 + member 5% (-50) + coupon 100 (-100)
      // → base for points = 850, not 1000.
      const baseAfterOtherDiscounts = Math.max(
        0,
        subtotalCents - memberDiscountCents - campaignDiscountCents - couponDiscountCents,
      )
      const cart: CartForPoints = {
        subtotal: baseAfterOtherDiscounts / 100,
        shipping: shippingFeeCents / 100,
        sale_item_total: 0,
        total: (baseAfterOtherDiscounts + shippingFeeCents) / 100,
      }
      const r = calcPointsDiscount(cart, requestedPointsUsed, settings)
      if (r.allowed) {
        pointsUsed = requestedPointsUsed
        pointsDiscountCents = Math.round(r.discount * 100)
      }
    }
  }

  const totalCents = Math.max(
    0,
    subtotalCents
      - memberDiscountCents
      - campaignDiscountCents
      - couponDiscountCents
      - pointsDiscountCents
      + shippingFeeCents,
  )
  const totalDiscount =
    memberDiscountCents + campaignDiscountCents + couponDiscountCents + pointsDiscountCents

  // Atomically deduct stock BEFORE creating the order — single RPC that
  // locks all variants and either succeeds or rejects with insufficient_stock.
  // This prevents the per-item race where two checkouts each see "enough left".
  const variantsPayload = items.map((i) => ({ id: i.variantId, qty: i.qty }))
  const stockResp = await supabase.rpc("atomic_deduct_stock", { p_variants: variantsPayload })
  if (stockResp.error) {
    console.error("[orders] atomic_deduct_stock failed:", stockResp.error)
    res.status(409).json({ error: "商品庫存不足" }); return
  }

  // Insert order
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      user_id: userId ?? null,
      guest_email: userId ? null : (guestEmail ?? null),
      status: "pending",
      payment_status: "pending",
      shipping_method: shippingMethod,
      payment_method: paymentMethod,
      subtotal: centsToTwd(subtotalCents),
      shipping_fee: centsToTwd(shippingFeeCents),
      discount_amount: centsToTwd(totalDiscount),
      total: centsToTwd(totalCents),
      campaign_discount: campaignDiscountCents / 100,
      applied_campaign_ids: appliedCampaignIds,
      free_items: freeItems,
      first_purchase_applied: firstPurchaseApplied,
      shipping_zeroed_by_campaign: shippingZeroedByCampaign,
      points_used: pointsUsed,
      attributed_kol_id: attributedKolId,
      attributed_kol_slug: attributedKolSlug,
      metadata: (couponCode || invoice)
        ? {
          ...(couponCode ? {
            coupon_code: couponCode,
            coupon_id: appliedCouponId,
            coupon_discount: centsToTwd(couponDiscountCents),
          } : {}),
          // Persist the chosen invoice so the post-payment pipeline issues the
          // right type (B2B 統編 / 載具 / 愛心碼) instead of a default B2C_2.
          ...(invoice ? { invoice } : {}),
        }
        : null,
    })
    .select("id, order_number")
    .single()

  if (orderError || !order) {
    console.error("[orders] insert order failed:", orderError)
    // Rollback: restore stock since order creation failed.
    await supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload })
    res.status(500).json({ error: "Failed to create order" }); return
  }

  // -------------------------------------------------------------------------
  // B1: guard points redemption against the concurrent double-redeem race.
  // The effective-balance check above can pass for two parallel checkouts that
  // both see the full balance → both redeem → negative ledger. Now that the
  // order row exists (with its points_used intent persisted), ask the DB to
  // confirm cumulative points intent across live orders up to THIS one does not
  // exceed the user's ledger. If it does, this order lost the race: tear it down
  // and 409. Guests have no points, so only run for logged-in users.
  // -------------------------------------------------------------------------
  if (userId && pointsUsed > 0) {
    const { data: pointsOk, error: pointsCheckError } = await supabase.rpc(
      "check_points_not_oversubscribed",
      { p_user_id: userId, p_order_id: order.id },
    )
    if (pointsCheckError) {
      console.error("[orders] check_points_not_oversubscribed failed:", pointsCheckError)
    }
    if (pointsOk === false) {
      // Lost the race. Delete the just-created order; no child rows have been
      // written yet at this point, but restore stock too (deducted above).
      await Promise.all([
        supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload }),
        supabase.from("orders").delete().eq("id", order.id),
      ])
      res.status(409).json({ error: "點數不足，可能因同時下單，請重新結帳" })
      return
    }
  }

  // B3: record the coupon use now that we have the order id. The code already
  // bumped coupons.used_count via atomic_increment_coupon_usage, but without a
  // coupon_uses row per-user limits can't be enforced and the cancel-path
  // rollback (which deletes coupon_uses for the order) has nothing to reverse.
  // Non-fatal: a paid order must not fail over this ledger row — but log loudly.
  // UNIQUE(coupon_id, order_id) makes a duplicate harmless.
  if (appliedCouponId) {
    const { error: couponUseError } = await supabase
      .from("coupon_uses")
      .insert({ coupon_id: appliedCouponId, user_id: userId ?? null, order_id: order.id })
    if (couponUseError) {
      console.error("[orders] insert coupon_uses failed (non-fatal):", couponUseError)
    }
  }

  // Insert order items
  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(
      items.map((item) => ({
        order_id: order.id,
        variant_id: item.variantId,
        qty: item.qty,
        unit_price: centsToTwd(unitPriceCents(item.variantId)),
        product_snapshot: {
          name: item.productName ?? variantMap.get(item.variantId)?.products?.name ?? "",
          variant_name: item.variantName ?? variantMap.get(item.variantId)?.name ?? "",
          unit_price: centsToTwd(unitPriceCents(item.variantId)),
        },
      }))
    )

  if (itemsError) {
    console.error("[orders] insert order_items failed:", itemsError)
    // Rollback: restore stock + delete the order in parallel.
    await Promise.all([
      supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload }),
      supabase.from("orders").delete().eq("id", order.id),
    ])
    res.status(500).json({ error: "Failed to create order items" }); return
  }

  // Insert order address
  // DB order_addresses has no country/district column, so fold both into the
  // address string: "[Country] 鄉鎮市區 街道…". District was previously dropped
  // entirely, leaving home-delivery addresses missing 行政區.
  const districtPrefix = address.addressType === "home" && address.district ? address.district : ""
  const streetPart = `${districtPrefix}${address.address ?? ""}`.trim()
  const fullAddress = address.country
    ? `[${address.country}] ${streetPart}`.trim()
    : (streetPart || null)

  const { error: addrError } = await supabase
    .from("order_addresses")
    .insert({
      order_id: order.id,
      type: address.type,
      name: address.name,
      phone: address.phone,
      address_type: address.addressType,
      address: fullAddress,
      city: address.city ?? null,
      postal_code: address.postalCode ?? null,
      cvs_store_id: address.cvsStoreId ?? null,
      cvs_type: address.cvsType ?? null,
    })

  if (addrError) {
    console.error("[orders] insert order_addresses failed:", addrError)
    // Rollback: restore stock, delete items + order in parallel.
    await Promise.all([
      supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload }),
      supabase.from("order_items").delete().eq("order_id", order.id),
      supabase.from("orders").delete().eq("id", order.id),
    ])
    res.status(500).json({ error: "Failed to create order address" }); return
  }

  // ---- test_paid：沙盒付款，跳過金流但跑完整 post-payment pipeline ----
  // 用途：驗證發票 / 訂單通知 / 庫存扣 / 點數累積 / LINE Notify 全鏈路是否
  // 正常，不用每次真的刷卡。Production 預設只允許 admin 使用；若測試環境
  // 真的需要開給一般登入用戶，必須顯式設定 ALLOW_NON_ADMIN_TEST_PAID=true。
  if (paymentMethod === "test_paid") {
    // Mark order as paid + processing — same end state as a webhook callback
    // from a real gateway would produce. (Paid time lives on payments.paid_at;
    // orders has no paid_at column — including one made this update silently
    // fail and left sandbox orders stuck on pending.)
    const { error: markPaidError } = await supabase
      .from("orders")
      .update({ status: "processing", payment_status: "paid" })
      .eq("id", order.id)
    if (markPaidError) {
      res.status(500).json({ error: `test_paid mark-paid failed: ${markPaidError.message}` })
      return
    }

    const { error: payErr } = await supabase.from("payments").insert({
      order_id: order.id,
      gateway: "test",
      gateway_tx_id: order.order_number,
      amount: Math.round(centsToTwd(totalCents)),
      status: "paid",
    })
    if (payErr) console.error("[test_paid] payments insert failed (order already marked paid):", payErr)

    // Run the full post-payment pipeline DETACHED, then respond immediately.
    // It used to be awaited inline "for immediate end-to-end signal", but the
    // pipeline makes several external calls (Resend emails ×2, Redis/BullMQ
    // enqueue ×2, Amego invoice) and a single slow/hanging step blocked the HTTP
    // response → the browser reported "Failed to fetch" even though the order was
    // already created + marked paid. Real gateways run this async via webhooks;
    // sandbox now matches that: checkout completes instantly and the pipeline
    // (invoice/email/stock/points) runs in the background, logging its own errors.
    void enqueuePostPaymentJobs(order.id).catch((err) =>
      console.warn("[test_paid] post-payment pipeline failed (non-fatal):", err),
    )

    res.status(201).json({
      data: {
        orderId: order.id,
        orderNumber: order.order_number,
        paymentMethod,
        sandbox: true,
      },
    })
    return
  }

  // ---- cvs_cod：不走線上金流，立即建立物流 ----
  if (paymentMethod === "cvs_cod") {
    // Insert payment record (pending, gateway = cvs_cod)
    const { error: codPayErr } = await supabase.from("payments").insert({
      order_id: order.id,
      gateway: "cvs_cod",
      gateway_tx_id: order.order_number,
      amount: Math.round(centsToTwd(totalCents)),
      status: "pending",
    })
    if (codPayErr) console.error("[cvs_cod] payments insert failed:", codPayErr)

    // Enqueue CVS COD logistics creation immediately (no payment wait)
    try {
      await inventoryQueue.add(
        "create-shipment-cod",
        { orderId: order.id },
        { attempts: 5, backoff: { type: "exponential", delay: 60000 } },
      )
    } catch (err) {
      console.warn("[orders] cvs_cod logistics enqueue failed (non-fatal):", err)
    }

    // Return without paymentUrl — frontend detects this and navigates to confirm
    res.status(201).json({
      data: {
        orderId: order.id,
        orderNumber: order.order_number,
        paymentMethod,
      },
    })
    return
  }

  // --- Payment initiation ---
  const siteUrl = getSiteUrl()
  const apiUrl = getApiBaseUrl()
  // The gateways redirect the user back to confirmUrl WITHOUT appending any
  // identifying params (PChomePay's return_url is dropped in verbatim). Embed
  // ?order=<orderNumber> so /checkout/confirm can look up status; without it
  // the page falls through to "no info → pending" and gets stuck.
  const confirmUrl = `${siteUrl}/checkout/confirm?order=${encodeURIComponent(order.order_number)}`
  let paymentUrl: string
  let gatewayTxId: string | null = null

  try {
    if (paymentMethod === "pchomepay") {
      const result = await pchomepayCreatePayment({
        orderId: order.id,
        orderNumber: order.order_number,
        amount: Math.round(centsToTwd(totalCents)),
        itemName: `realreal order #${order.order_number}`,
        returnUrl: confirmUrl,
        notifyUrl: `${apiUrl}/webhooks/pchomepay`,
      })
      paymentUrl = result.paymentUrl
      gatewayTxId = order.order_number

    } else if (paymentMethod === "linepay") {
      const result = await linePayRequestPayment(
        order.order_number,
        Math.round(centsToTwd(totalCents)),
        `realreal order #${order.order_number}`
      )
      paymentUrl = result.paymentUrl
      gatewayTxId = result.transactionId

    } else {
      // jkopay
      const result = await jkoPayInitiatePayment(order.order_number, Math.round(centsToTwd(totalCents)))
      paymentUrl = result.paymentUrl
      gatewayTxId = result.merchantTradeNo
    }
  } catch (err) {
    console.error(`[orders] ${paymentMethod} payment initiation failed:`, err)
    // Rollback: delete child tables + restore stock first, then delete parent order.
    // Order matters: payments/items/addresses must be removed before orders (FK).
    await Promise.all([
      supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload }),
      supabase.from("payments").delete().eq("order_id", order.id),
      supabase.from("order_addresses").delete().eq("order_id", order.id),
      supabase.from("order_items").delete().eq("order_id", order.id),
    ])
    await supabase.from("orders").delete().eq("id", order.id)
    res.status(502).json({ error: "Payment gateway error" }); return
  }

  // Insert payment record
  const { error: paymentError } = await supabase
    .from("payments")
    .insert({
      order_id: order.id,
      gateway: paymentMethod,
      gateway_tx_id: gatewayTxId,
      amount: Math.round(centsToTwd(totalCents)),
      status: "pending",
    })

  if (paymentError) {
    console.error("[orders] insert payment failed:", paymentError)
    await Promise.all([
      supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload }),
      supabase.from("order_addresses").delete().eq("order_id", order.id),
      supabase.from("order_items").delete().eq("order_id", order.id),
    ])
    await supabase.from("orders").delete().eq("id", order.id)
    res.status(500).json({ error: "Failed to create payment record" })
    return
  }

  res.status(201).json({
    data: {
      orderId: order.id,
      orderNumber: order.order_number,
      paymentUrl,
      paymentMethod,
      memberDiscountAmount: memberDiscountCents,
      discountRate,
    },
  })
})

// GET /orders/:id — get order with items, address, payment status (auth required, must own order)
ordersRouter.get("/:id", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string
  const orderId = req.params.id

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single()

  if (orderError || !order) { res.status(404).json({ error: "Order not found" }); return }
  if (order.user_id !== userId) { res.status(403).json({ error: "Forbidden" }); return }

  const [{ data: items }, { data: addresses }, { data: payments }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", orderId),
    supabase.from("order_addresses").select("*").eq("order_id", orderId),
    supabase.from("payments").select("*").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1),
  ])

  // 本次訂單的公益存款（= 公益點數）。
  // 真實入帳來源：post-payment pipeline 的 grantPoints() 寫進 points_ledger 的
  // source='earn' 列（source_ref_id = 此訂單），delta =
  //   floor(earnBaseTwd * tier.rebate_rate / 100) × 活動加倍係數
  // 1 點 = NT$1（見前台 PointsCard）。直接讀回該列 delta 才能保證顯示金額
  // 等於實際入帳金額（不重算、不四捨五入漂移、含活動加倍）。未付款 / 訪客 /
  // 0% 回饋的訂單沒有 earn 列 → 回 0，符合實際情況。
  let charityPoints = 0
  {
    const { data: earnRows } = await supabase
      .from("points_ledger")
      .select("delta")
      .eq("source", "earn")
      .eq("source_ref_id", orderId)
      .eq("user_id", userId)
    charityPoints = (earnRows ?? []).reduce(
      (sum: number, r: Record<string, unknown>) => sum + Number(r.delta ?? 0),
      0,
    )
  }

  // 會員等級 + 公益回饋率：用下單者的 user_profiles.membership_tier_id 查
  // membership_tiers 取 name 與 rebate_rate（NUMERIC(5,2)，存「百分比」值，
  // 如 2.30 代表 2.3%；point-grant 用 rebate_rate / 100 計算，見 lib/points.ts
  // grantPoints）。訪客訂單（無 user_id）或查無等級 → null。
  let memberTier: { name: string; rebate_rate: number } | null = null
  if (order.user_id) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("membership_tier_id")
      .eq("user_id", order.user_id)
      .maybeSingle()
    const tierId = (profile as { membership_tier_id: string | null } | null)?.membership_tier_id ?? null
    if (tierId) {
      const { data: tier } = await supabase
        .from("membership_tiers")
        .select("name, rebate_rate")
        .eq("id", tierId)
        .maybeSingle()
      if (tier) {
        memberTier = {
          name: (tier as { name: string | null }).name ?? "",
          rebate_rate: Number((tier as { rebate_rate?: number | string | null }).rebate_rate ?? 0),
        }
      }
    }
  }

  // Resolve campaign names so the customer-facing breakdown can label the
  // campaign discount (mirrors the admin order page).
  let campaignNames: string[] = []
  const campaignIds = ((order as Record<string, unknown>).applied_campaign_ids ?? []) as string[]
  if (campaignIds.length > 0) {
    const { data: campaigns } = await supabase
      .from("campaigns")
      .select("name")
      .in("id", campaignIds)
    campaignNames = (campaigns ?? []).map((c) => (c as { name: string | null }).name ?? "").filter(Boolean)
  }

  const addr = addresses?.[0] ?? null
  res.json({
    data: {
      id: order.id,
      order_number: order.order_number,
      created_at: order.created_at,
      status: order.status,
      total: Number(order.total),
      subtotal: Number(order.subtotal),
      shipping_fee: Number(order.shipping_fee),
      discount_amount: Number(order.discount_amount),
      campaign_discount: Number((order as Record<string, unknown>).campaign_discount ?? 0),
      points_used: Number((order as Record<string, unknown>).points_used ?? 0),
      charity_points: charityPoints,
      member_tier: memberTier,
      metadata: (order as Record<string, unknown>).metadata ?? null,
      campaign_names: campaignNames,
      attributed_kol_slug: (order as Record<string, unknown>).attributed_kol_slug ?? null,
      free_items: (order as Record<string, unknown>).free_items ?? [],
      shipping_zeroed_by_campaign: Boolean((order as Record<string, unknown>).shipping_zeroed_by_campaign),
      payment_method: order.payment_method ?? "",
      payment_status: order.payment_status ?? "pending",
      shipping_method: order.shipping_method ?? "",
      shipping_status: (order as Record<string, unknown>).shipping_status as string ?? "pending",
      address: addr ? {
        name: addr.name,
        phone: addr.phone,
        city: addr.city,
        postal_code: addr.postal_code,
        address_type: addr.address_type,
        address: addr.address,
      } : null,
      items: (items ?? []).map((item: Record<string, unknown>) => ({
        id: item.id,
        qty: item.qty,
        unit_price: Number(item.unit_price),
        product_snapshot: item.product_snapshot,
      })),
    },
  })
})

// GET /orders — list user's orders, paginated (auth required)
ordersRouter.get("/", requireAuth, async (req, res) => {
  const userId = res.locals.userId as string
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10))
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)))
  const from = (page - 1) * limit
  const to = from + limit - 1

  const { data, error, count } = await supabase
    .from("orders")
    .select("id, order_number, status, total, payment_method, shipping_method, created_at", { count: "estimated" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) { res.status(500).json({ error: error.message }); return }

  res.json({
    data: (data ?? []).map((o: Record<string, unknown>) => ({ ...o, total: Number(o.total) })),
    pagination: { page, limit, total: count ?? 0 },
  })
})

// GET /orders/by-number/:orderNumber/status — public, returns the minimal
// status info the post-payment confirm page needs. No PII, no items.
ordersRouter.get("/by-number/:orderNumber/status", async (req, res) => {
  const { data, error } = await supabase
    .from("orders")
    .select("order_number, status, payment_status, payment_method, total")
    .eq("order_number", req.params.orderNumber)
    .maybeSingle()
  if (error || !data) { res.status(404).json({ error: "Order not found" }); return }
  res.json({ data })
})
