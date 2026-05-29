import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"

export const couponsRouter = Router()

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const couponCreateSchema = z.object({
  code: z.string().min(1).max(64),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
  min_order: z.number().nonnegative().optional().default(0),
  max_uses: z.number().int().positive().optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
  applicable_to: z.enum(["order", "subscription", "both"]).optional().default("order"),
  is_active: z.boolean().optional().default(true),
  tier_id: z.string().uuid().optional().nullable(),
})

const couponUpdateSchema = couponCreateSchema.partial()

const bulkGenerateSchema = z.object({
  count: z.number().int().min(1).max(100),
  prefix: z.string().max(16).optional().default(""),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
  min_order: z.number().nonnegative().optional().default(0),
  max_uses: z.number().int().positive().optional().nullable(),
  expires_at: z.string().datetime().optional().nullable(),
  applicable_to: z.enum(["order", "subscription", "both"]).optional().default("order"),
})

// ---------------------------------------------------------------------------
// POST /coupons/validate — public (but typically used by authenticated users)
// ---------------------------------------------------------------------------

// requireAuth dropped — guest checkout needs to validate coupons too.
// requireOptionalAuth-style: read userId from header if present, otherwise null.
couponsRouter.post("/coupons/validate", async (req, res) => {
  const { code, order_amount } = req.body as { code?: string; order_amount?: number }

  if (!code) { res.status(400).json({ error: "code is required" }); return }

  // Best-effort: pull userId from a Bearer header if the caller is logged in,
  // so tier-locked coupons still work for guests AND members.
  let userId: string | undefined
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7))
    userId = user?.id
  }

  const { data: coupon, error } = await supabase
    .from("coupons")
    .select("id, code, type, value, min_order, max_uses, used_count, expires_at, applicable_to, tier_id")
    .eq("code", code)
    .single()

  if (error || !coupon) { res.status(404).json({ error: "Coupon not found" }); return }

  // Check tier eligibility
  if (coupon.tier_id) {
    if (!userId) { res.status(403).json({ error: "Coupon requires membership tier eligibility" }); return }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("membership_tier_id")
      .eq("user_id", userId)
      .single()

    if (!profile || profile.membership_tier_id !== coupon.tier_id) {
      res.status(403).json({ error: "You are not eligible for this coupon based on your membership tier" }); return
    }
  }

  // Check expiry
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    res.status(400).json({ error: "Coupon has expired" }); return
  }

  // Check max uses
  if (coupon.max_uses !== null && coupon.max_uses !== undefined && Number(coupon.used_count) >= Number(coupon.max_uses)) {
    res.status(400).json({ error: "Coupon has reached maximum usage" }); return
  }

  // Check min order
  const orderAmt = Number(order_amount ?? 0)
  if (orderAmt < Number(coupon.min_order ?? 0)) {
    res.status(400).json({ error: `Minimum order amount is ${coupon.min_order}` }); return
  }

  // Compute discount
  let discount = 0
  if (coupon.type === "percentage") {
    discount = Math.round((orderAmt * Number(coupon.value)) / 100)
  } else {
    discount = Math.min(Number(coupon.value), orderAmt)
  }

  res.json({
    data: {
      coupon_id: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount,
      final_amount: Math.max(0, orderAmt - discount),
      applicable_to: coupon.applicable_to,
    },
  })
})

// ---------------------------------------------------------------------------
// GET /admin/coupons — list all (admin only)
// ---------------------------------------------------------------------------

couponsRouter.get("/admin/coupons", requireAuth, requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from("coupons")
    .select("*")
    .order("code", { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})

// ---------------------------------------------------------------------------
// POST /admin/coupons — create coupon (admin only)
// ---------------------------------------------------------------------------

couponsRouter.post("/admin/coupons", requireAuth, requireAdmin, async (req, res) => {
  const parsed = couponCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("coupons")
    .insert({ ...parsed.data, used_count: 0 })
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// ---------------------------------------------------------------------------
// PUT /admin/coupons/:id — update coupon (admin only)
// ---------------------------------------------------------------------------

couponsRouter.put("/admin/coupons/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = couponUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("coupons")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Coupon not found" }); return }
  res.json({ data })
})

// ---------------------------------------------------------------------------
// DELETE /admin/coupons/:id — delete coupon (admin only)
// ---------------------------------------------------------------------------

couponsRouter.delete("/admin/coupons/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("coupons")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// ---------------------------------------------------------------------------
// POST /admin/coupons/bulk-generate — generate N codes (admin only, max 100)
// ---------------------------------------------------------------------------

couponsRouter.post("/admin/coupons/bulk-generate", requireAuth, requireAdmin, async (req, res) => {
  const parsed = bulkGenerateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { count, prefix, type, value, min_order, max_uses, expires_at, applicable_to } = parsed.data

  const rows = Array.from({ length: count }, () => {
    const suffix = Math.random().toString(36).slice(2, 10).toUpperCase()
    return {
      code: `${prefix}${suffix}`,
      type,
      value,
      min_order: min_order ?? 0,
      max_uses: max_uses ?? null,
      expires_at: expires_at ?? null,
      applicable_to,
      is_active: true,
      used_count: 0,
    }
  })

  const { data, error } = await supabase
    .from("coupons")
    .insert(rows)
    .select("id, code")

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data, count: (data ?? []).length })
})
