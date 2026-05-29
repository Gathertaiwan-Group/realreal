import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { getMemberDiscountRate } from "../lib/tier"
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

// POST /orders — create order from cart items
ordersRouter.post("/", async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() }); return
  }

  const { items, address, shippingMethod, paymentMethod, guestEmail, couponCode } = parsed.data
  const userId: string | undefined = res.locals.userId

  const orderNumber = "RR" + Date.now()
  const subtotalCents = items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0)
  const shippingFees: Record<string, number> = { home_delivery: 100, cvs_711: 60, cvs_family: 60 }
  const shippingFeeCents = shippingFees[shippingMethod] ?? 100

  // Apply member discount based on membership tier
  const discountRate = await getMemberDiscountRate(userId)
  const memberDiscountCents = Math.round(subtotalCents * discountRate)
  const totalCents = subtotalCents - memberDiscountCents + shippingFeeCents

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
      discount_amount: memberDiscountCents,
      total: totalCents,
      metadata: couponCode ? { coupon_code: couponCode } : null,
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
  const confirmUrl = `${siteUrl}/checkout/confirm`
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
