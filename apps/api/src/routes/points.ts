import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import {
  calcPointsDiscount,
  loadPointsSettings,
  type CartForPoints,
} from "../lib/points"

/**
 * Public points endpoints — mounted at `/points` in app.ts.
 *
 * Spec: docs/superpowers/specs/2026-05-30-points-tiers-customer-detail-design.md
 *
 *   POST /points/apply    — compute checkout discount preview (auth)
 *   GET  /points/balance  — current balance + expiring-soon (auth)
 *   GET  /points/ledger   — paginated ledger rows for current user (auth)
 *
 * All settings come back from app_settings as strings; numeric/boolean
 * coercion lives inside loadPointsSettings (lib/points.ts).
 */

export const pointsRouter = Router()

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const cartSchema = z.object({
  subtotal: z.number().nonnegative(),
  shipping: z.number().nonnegative(),
  sale_item_total: z.number().nonnegative(),
  total: z.number().nonnegative(),
})

const applySchema = z.object({
  cart: cartSchema,
  requested_points: z.number().int(),
})

const ledgerQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
})

// ---------------------------------------------------------------------------
// POST /points/apply — checkout discount calc preview
// ---------------------------------------------------------------------------

pointsRouter.post("/apply", requireAuth, async (req, res) => {
  const parsed = applySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const { cart, requested_points } = parsed.data

  let settings
  try {
    settings = await loadPointsSettings()
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to load points settings" })
    return
  }

  const result = calcPointsDiscount(cart as CartForPoints, requested_points, settings)

  if (result.allowed) {
    res.json({ allowed: true, discount: result.discount })
    return
  }
  res.json({ allowed: false, discount: 0, reason: result.reason })
})

// ---------------------------------------------------------------------------
// GET /points/balance — { balance, expiring_soon }
// expiring_soon = sum of earn rows expiring within 30d that aren't yet
// matched by an `expire` ledger row
// ---------------------------------------------------------------------------

pointsRouter.get("/balance", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string

  // Balance = SUM(delta) over every row for the user
  const { data: rows, error: rowsErr } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("user_id", userId)

  if (rowsErr) {
    res.status(500).json({ error: rowsErr.message })
    return
  }
  const balance = (rows ?? []).reduce(
    (acc: number, r: any) => acc + Number(r.delta ?? 0),
    0,
  )

  // Expiring soon: candidate earn rows whose expires_at falls in [now, now+30d]
  const now = new Date()
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const { data: earnRows, error: earnErr } = await supabase
    .from("points_ledger")
    .select("id, delta")
    .eq("user_id", userId)
    .eq("source", "earn")
    .not("expires_at", "is", null)
    .gte("expires_at", now.toISOString())
    .lte("expires_at", horizon.toISOString())

  if (earnErr) {
    res.status(500).json({ error: earnErr.message })
    return
  }

  let expiringSoon = 0
  if (earnRows && earnRows.length > 0) {
    // Filter out any earn already matched by an expire row (covers the
    // edge case where expire ran early — shouldn't normally happen since
    // we constrain to future-expiring rows, but defensive).
    const earnIds = earnRows.map((r: any) => r.id as string)
    const { data: alreadyExpired } = await supabase
      .from("points_ledger")
      .select("source_ref_id")
      .eq("source", "expire")
      .in("source_ref_id", earnIds)

    const expiredSet = new Set<string>()
    for (const row of alreadyExpired ?? []) {
      const ref = (row as { source_ref_id: string | null }).source_ref_id
      if (ref) expiredSet.add(ref)
    }

    for (const r of earnRows as any[]) {
      if (!expiredSet.has(r.id as string)) {
        expiringSoon += Number(r.delta ?? 0)
      }
    }
  }

  res.json({ balance, expiring_soon: expiringSoon })
})

// ---------------------------------------------------------------------------
// GET /points/ledger?limit=20&offset=0 — paginated ledger for current user
// ---------------------------------------------------------------------------

pointsRouter.get("/ledger", requireAuth, async (req, res) => {
  const parsed = ledgerQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }
  const { limit, offset } = parsed.data

  const userId = res.locals.userId as string

  const { data, error, count } = await supabase
    .from("points_ledger")
    .select(
      "id, delta, source, source_ref_id, note, expires_at, created_at",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ rows: data ?? [], total: count ?? 0 })
})
