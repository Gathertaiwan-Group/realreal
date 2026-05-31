import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth, optionalAuth } from "../middleware/auth"
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

export const ordersRouter = Router()

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
  phone: z.string().regex(/^09\d{8}$/),
  addressType: z.enum(["home", "cvs"]),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  cvsStoreId: z.string().optional(),
  cvsType: z.string().optional(),
})

const createOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  address: addressSchema,
  shippingMethod: z.enum(["home_delivery", "cvs_711", "cvs_family"]),
  paymentMethod: z.enum(["pchomepay", "linepay", "jkopay"]),
  guestEmail: z.string().email().optional(),
  couponCode: z.string().optional(),
})

// POST /orders — create order from cart items.
// optionalAuth: if a Bearer token is present, the order is linked to that
// user; if absent, the order is created as a guest checkout (user_id=null,
// guest_email used). Either path is fine.
ordersRouter.post("/", optionalAuth, async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() }); return
  }

  const { items, address, shippingMethod, paymentMethod, guestEmail } = parsed.data
  let { couponCode } = parsed.data
  const userId: string | undefined = res.locals.userId

  const orderNumber = "RR" + Date.now()
  const subtotalCents = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0)
  const shippingFees: Record<string, number> = { home_delivery: 100, cvs_711: 60, cvs_family: 60 }
  let shippingFeeCents = shippingFees[shippingMethod] ?? 100

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
      .select("id, slug, coupon_id, is_active")
      .eq("slug", kolRefCookie)
      .eq("is_active", true)
      .maybeSingle()
    if (kol) {
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

  // Fetch variant → product → category mapping for cart items in a single round-trip.
  // The evaluator's CartItem expects unit_price as dollars (not cents).
  const variantIds = items.map((i) => i.variantId)
  const { data: variantRows } = await supabase
    .from("product_variants")
    .select("id, sku, name, product_id, products(category_id, name)")
    .in("id", variantIds)
  type VariantRow = {
    id: string
    sku: string | null
    name: string
    product_id: string
    products: { category_id: string | null; name: string | null } | null
  }
  const variantMap = new Map<string, VariantRow>()
  for (const row of (variantRows ?? []) as unknown as VariantRow[]) {
    variantMap.set(row.id, row)
  }
  const cartItems: CartItem[] = items.map((item) => {
    const v = variantMap.get(item.variantId)
    return {
      product_id: v?.product_id ?? "",
      variant_id: item.variantId,
      category_id: v?.products?.category_id ?? null,
      sku: v?.sku ?? null,
      name: item.productName ?? v?.products?.name ?? v?.name ?? "",
      unit_price: item.unitPrice / 100,
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
  for (const r of campaignResults) {
    if (r.discount_amount) {
      campaignDiscountCents += Math.round(r.discount_amount * 100)
    }
    if (r.free_items && r.free_items.length > 0) {
      freeItems.push(...r.free_items)
    }
    if (r.zero_shipping) {
      shippingFeeCents = 0
    }
  }
  // "preview" sentinel comes from POST /admin/campaigns/preview; real
  // checkout results never carry it, but skip defensively.
  const appliedCampaignIds = campaignResults
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
      .select("id, type, value, min_order, max_uses, used_count, expires_at, tier_id")
      .eq("code", couponCode)
      .maybeSingle()
    const now = new Date()
    const valid =
      coupon &&
      (!coupon.expires_at || new Date(coupon.expires_at) >= now) &&
      (coupon.max_uses == null || coupon.used_count < coupon.max_uses) &&
      (coupon.min_order == null || subtotalCents >= coupon.min_order)
    if (valid && coupon) {
      const baseAfterCampaigns = Math.max(
        0,
        subtotalCents - memberDiscountCents - campaignDiscountCents,
      )
      if (coupon.type === "percentage") {
        couponDiscountCents = Math.round(baseAfterCampaigns * (Number(coupon.value) / 100))
      } else if (coupon.type === "fixed") {
        couponDiscountCents = Math.min(baseAfterCampaigns, Math.round(Number(coupon.value)))
      } else if (coupon.type === "free_shipping") {
        // Don't deduct from items; zero the shipping fee instead.
        shippingFeeCents = 0
      }
      appliedCouponId = coupon.id
    }
  }

  const totalCents = Math.max(
    0,
    subtotalCents
      - memberDiscountCents
      - campaignDiscountCents
      - couponDiscountCents
      + shippingFeeCents,
  )
  const totalDiscount = memberDiscountCents + campaignDiscountCents + couponDiscountCents

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
      subtotal: subtotalCents,
      shipping_fee: shippingFeeCents,
      discount_amount: totalDiscount,
      total: totalCents,
      campaign_discount: campaignDiscountCents / 100,
      applied_campaign_ids: appliedCampaignIds,
      free_items: freeItems,
      attributed_kol_id: attributedKolId,
      attributed_kol_slug: attributedKolSlug,
      metadata: couponCode
        ? { coupon_code: couponCode, coupon_id: appliedCouponId, coupon_discount: couponDiscountCents }
        : null,
    })
    .select("id, order_number")
    .single()

  if (orderError || !order) {
    console.error("[orders] insert order failed:", orderError)
    res.status(500).json({ error: "Failed to create order" }); return
  }

  // Insert order items
  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(
      items.map((item) => ({
        order_id: order.id,
        variant_id: item.variantId,
        qty: item.qty,
        unit_price: item.unitPrice,
        product_snapshot: {
          name: item.productName ?? "",
          variant_name: item.variantName ?? "",
          unit_price: item.unitPrice,
        },
      }))
    )

  if (itemsError) {
    console.error("[orders] insert order_items failed:", itemsError)
    // Rollback: delete the order
    await supabase.from("orders").delete().eq("id", order.id)
    res.status(500).json({ error: "Failed to create order items" }); return
  }

  // Deduct stock from product_variants (reserve stock before payment)
  const deductedVariants: { variantId: string; qty: number }[] = []
  for (const item of items) {
    const { data: success, error: stockError } = await supabase.rpc("deduct_variant_stock", {
      p_variant_id: item.variantId,
      p_qty: item.qty,
    })

    if (stockError || success === false) {
      console.error("[orders] insufficient stock for variant:", item.variantId, stockError)
      // Restore stock for variants already deducted in this loop
      for (const prev of deductedVariants) {
        await supabase.rpc("restore_variant_stock", {
          p_variant_id: prev.variantId,
          p_qty: prev.qty,
        })
      }
      // Rollback: delete items and order
      await supabase.from("order_items").delete().eq("order_id", order.id)
      await supabase.from("orders").delete().eq("id", order.id)
      res.status(409).json({ error: "Insufficient stock", variantId: item.variantId }); return
    }

    deductedVariants.push({ variantId: item.variantId, qty: item.qty })
  }

  // Insert order address
  const { error: addrError } = await supabase
    .from("order_addresses")
    .insert({
      order_id: order.id,
      type: address.type,
      name: address.name,
      phone: address.phone,
      address_type: address.addressType,
      address: address.address ?? null,
      city: address.city ?? null,
      postal_code: address.postalCode ?? null,
      cvs_store_id: address.cvsStoreId ?? null,
      cvs_type: address.cvsType ?? null,
    })

  if (addrError) {
    console.error("[orders] insert order_addresses failed:", addrError)
    // Rollback: delete items and order
    await supabase.from("order_items").delete().eq("order_id", order.id)
    await supabase.from("orders").delete().eq("id", order.id)
    res.status(500).json({ error: "Failed to create order address" }); return
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
        amount: totalCents,
        itemName: `realreal order #${order.order_number}`,
        returnUrl: confirmUrl,
        notifyUrl: `${apiUrl}/webhooks/pchomepay`,
      })
      paymentUrl = result.paymentUrl
      gatewayTxId = order.order_number

    } else if (paymentMethod === "linepay") {
      const result = await linePayRequestPayment(
        order.order_number,
        totalCents,
        `realreal order #${order.order_number}`
      )
      paymentUrl = result.paymentUrl
      gatewayTxId = result.transactionId

    } else {
      // jkopay
      const result = await jkoPayInitiatePayment(order.order_number, totalCents)
      paymentUrl = result.paymentUrl
      gatewayTxId = result.merchantTradeNo
    }
  } catch (err) {
    console.error(`[orders] ${paymentMethod} payment initiation failed:`, err)
    // Rollback: restore stock, delete address, items, and order
    for (const prev of deductedVariants) {
      await supabase.rpc("restore_variant_stock", {
        p_variant_id: prev.variantId,
        p_qty: prev.qty,
      })
    }
    await supabase.from("order_addresses").delete().eq("order_id", order.id)
    await supabase.from("order_items").delete().eq("order_id", order.id)
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
      amount: totalCents,
      status: "pending",
    })

  if (paymentError) {
    console.error("[orders] insert payment failed:", paymentError)
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

  res.json({
    data: {
      order,
      items: items ?? [],
      address: addresses?.[0] ?? null,
      payment: payments?.[0] ?? null,
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
    .select("id, order_number, status, total, payment_method, shipping_method, created_at", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) { res.status(500).json({ error: error.message }); return }

  res.json({
    data: data ?? [],
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
