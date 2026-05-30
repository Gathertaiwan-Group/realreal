import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"

/**
 * Admin KOL / affiliate CRUD + stats.
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
 * (Section 2).
 *
 * Endpoints (all require auth + admin role):
 *   - GET    /admin/kols                — list with order_count / total_revenue / est_commission
 *   - GET    /admin/kols/:id            — detail incl. recent 50 attributed orders
 *   - POST   /admin/kols                — create
 *   - PUT    /admin/kols/:id            — partial update
 *   - DELETE /admin/kols/:id            — soft delete (hard only if no orders)
 *   - GET    /admin/kols/:id/stats?from=&to= — date-range commission summary
 */
export const adminKolsRouter = Router()

adminKolsRouter.use(requireAuth, requireAdmin)

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens")

const kolCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  avatar_url: z.string().url().max(2048).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  instagram_handle: z.string().max(64).optional().nullable(),
  youtube_handle: z.string().max(64).optional().nullable(),
  tiktok_handle: z.string().max(64).optional().nullable(),
  coupon_id: z.string().uuid().optional().nullable(),
  commission_rate: z.number().min(0).max(100).optional().default(10),
  is_active: z.boolean().optional().default(true),
  notes: z.string().max(2000).optional().nullable(),
})

const kolUpdateSchema = kolCreateSchema.partial()

// ---------------------------------------------------------------------------
// Helper — compute aggregate stats for a list of kol ids in one round-trip
// ---------------------------------------------------------------------------

type KolAgg = { order_count: number; total_revenue: number }

async function aggregateOrders(
  kolIds: string[],
  range?: { from?: string; to?: string },
): Promise<Record<string, KolAgg>> {
  if (kolIds.length === 0) return {}

  let query = supabase
    .from("orders")
    .select("attributed_kol_id, total")
    .in("attributed_kol_id", kolIds)

  if (range?.from) query = query.gte("created_at", range.from)
  if (range?.to) query = query.lte("created_at", range.to)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const acc: Record<string, KolAgg> = {}
  for (const id of kolIds) acc[id] = { order_count: 0, total_revenue: 0 }
  for (const row of data ?? []) {
    const id = (row as { attributed_kol_id: string | null }).attributed_kol_id
    if (!id || !acc[id]) continue
    acc[id].order_count += 1
    acc[id].total_revenue += Number((row as { total: number | string }).total ?? 0)
  }
  return acc
}

// ---------------------------------------------------------------------------
// GET /admin/kols — list with aggregate stats
// ---------------------------------------------------------------------------

adminKolsRouter.get("/", async (_req, res) => {
  const { data: kols, error } = await supabase
    .from("kols")
    .select(
      "id, slug, name, avatar_url, bio, instagram_handle, youtube_handle, tiktok_handle, " +
        "coupon_id, commission_rate, is_active, notes, created_at, updated_at, " +
        "coupons(id, code, type, value)",
    )
    .order("created_at", { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Supabase types narrow imperfectly with joins; cast through unknown.
  const list = (kols ?? []) as unknown as Array<Record<string, unknown> & {
    id: string
    commission_rate: number | string | null
  }>
  const ids = list.map((k) => k.id)

  let aggregates: Record<string, KolAgg> = {}
  try {
    aggregates = await aggregateOrders(ids)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }

  const enriched = list.map((k) => {
    const agg = aggregates[k.id] ?? { order_count: 0, total_revenue: 0 }
    const rate = Number(k.commission_rate ?? 0)
    const estCommission = Math.round(agg.total_revenue * rate) / 100
    return {
      ...k,
      order_count: agg.order_count,
      total_revenue: agg.total_revenue,
      est_commission: estCommission,
    }
  })

  res.json({ data: enriched })
})

// ---------------------------------------------------------------------------
// GET /admin/kols/:id — detail with recent 50 attributed orders
// ---------------------------------------------------------------------------

adminKolsRouter.get("/:id", async (req, res) => {
  const { data: kol, error } = await supabase
    .from("kols")
    .select(
      "id, slug, name, avatar_url, bio, instagram_handle, youtube_handle, tiktok_handle, " +
        "coupon_id, commission_rate, is_active, notes, created_at, updated_at, " +
        "coupons(id, code, type, value)",
    )
    .eq("id", req.params.id)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!kol) {
    res.status(404).json({ error: "KOL not found" })
    return
  }
  const kolRow = kol as unknown as Record<string, unknown> & {
    commission_rate: number | string | null
  }

  // Recent 50 attributed orders
  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, order_number, total, status, payment_status, user_id, created_at, attributed_kol_slug",
    )
    .eq("attributed_kol_id", req.params.id)
    .order("created_at", { ascending: false })
    .limit(50)

  // Lifetime stats
  let aggregates: Record<string, KolAgg> = {}
  try {
    aggregates = await aggregateOrders([req.params.id])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }
  const agg = aggregates[req.params.id] ?? { order_count: 0, total_revenue: 0 }
  const rate = Number(kolRow.commission_rate ?? 0)
  const estCommission = Math.round(agg.total_revenue * rate) / 100

  res.json({
    data: {
      ...kolRow,
      order_count: agg.order_count,
      total_revenue: agg.total_revenue,
      est_commission: estCommission,
      recent_orders: orders ?? [],
    },
  })
})

// ---------------------------------------------------------------------------
// POST /admin/kols — create
// ---------------------------------------------------------------------------

adminKolsRouter.post("/", async (req, res) => {
  const parsed = kolCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }

  // If coupon_id supplied, verify it exists.
  if (parsed.data.coupon_id) {
    const { data: coupon } = await supabase
      .from("coupons")
      .select("id")
      .eq("id", parsed.data.coupon_id)
      .maybeSingle()
    if (!coupon) {
      res.status(400).json({ error: "Coupon not found" })
      return
    }
  }

  const { data, error } = await supabase
    .from("kols")
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    // 23505 = unique violation (slug)
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Slug already exists" })
      return
    }
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json({ data })
})

// ---------------------------------------------------------------------------
// PUT /admin/kols/:id — partial update
// ---------------------------------------------------------------------------

adminKolsRouter.put("/:id", async (req, res) => {
  const parsed = kolUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }

  if (parsed.data.coupon_id) {
    const { data: coupon } = await supabase
      .from("coupons")
      .select("id")
      .eq("id", parsed.data.coupon_id)
      .maybeSingle()
    if (!coupon) {
      res.status(400).json({ error: "Coupon not found" })
      return
    }
  }

  const { data, error } = await supabase
    .from("kols")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Slug already exists" })
      return
    }
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(404).json({ error: "KOL not found" })
    return
  }
  res.json({ data })
})

// ---------------------------------------------------------------------------
// DELETE /admin/kols/:id — soft delete; hard delete only if no orders linked
// ---------------------------------------------------------------------------

adminKolsRouter.delete("/:id", async (req, res) => {
  const id = req.params.id

  // Count attributed orders. head:true skips row payload (count-only).
  const { count, error: countErr } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("attributed_kol_id", id)

  if (countErr) {
    res.status(500).json({ error: countErr.message })
    return
  }

  if ((count ?? 0) === 0) {
    // Hard delete — no audit data to preserve.
    const { error } = await supabase.from("kols").delete().eq("id", id)
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(204).send()
    return
  }

  // Soft delete — keep row for audit, just deactivate.
  const { data, error } = await supabase
    .from("kols")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(404).json({ error: "KOL not found" })
    return
  }
  res.json({ ok: true, soft: true, order_count: count ?? 0 })
})

// ---------------------------------------------------------------------------
// GET /admin/kols/:id/stats?from=&to= — date-range commission summary
// ---------------------------------------------------------------------------

const statsQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})

adminKolsRouter.get("/:id/stats", async (req, res) => {
  const parsed = statsQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.flatten() })
    return
  }

  const id = req.params.id

  const { data: kol, error: kolErr } = await supabase
    .from("kols")
    .select("id, slug, name, commission_rate")
    .eq("id", id)
    .maybeSingle()
  if (kolErr) {
    res.status(500).json({ error: kolErr.message })
    return
  }
  if (!kol) {
    res.status(404).json({ error: "KOL not found" })
    return
  }

  let aggregates: Record<string, KolAgg> = {}
  try {
    aggregates = await aggregateOrders([id], parsed.data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
    return
  }
  const agg = aggregates[id] ?? { order_count: 0, total_revenue: 0 }
  const rate = Number(kol.commission_rate ?? 0)
  const estCommission = Math.round(agg.total_revenue * rate) / 100

  res.json({
    data: {
      kol_id: id,
      slug: kol.slug,
      name: kol.name,
      commission_rate: rate,
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      order_count: agg.order_count,
      total_revenue: agg.total_revenue,
      est_commission: estCommission,
    },
  })
})
