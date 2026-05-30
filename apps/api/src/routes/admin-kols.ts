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
 *   - GET    /admin/kols/:id/stats?from=&to=       — date-range commission summary
 *   - GET    /admin/kols/:id/conversion?from=&to=  — click→order conversion dashboard (spec K)
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

// ---------------------------------------------------------------------------
// GET /admin/kols/:id/conversion?from=&to= — click→order conversion dashboard
// Spec K: docs/superpowers/specs/2026-05-31-K-kol-conversion-dashboard-design.md
// ---------------------------------------------------------------------------

// Accept either full ISO datetime (e.g. 2026-05-01T00:00:00.000Z) or plain
// ISO date (e.g. 2026-05-01). The spec calls these "ISO date strings".
const isoDateOrDatetime = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date string")

const conversionQuerySchema = z.object({
  from: isoDateOrDatetime.optional(),
  to: isoDateOrDatetime.optional(),
})

adminKolsRouter.get("/:id/conversion", async (req, res) => {
  const parsed = conversionQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid query", details: parsed.error.flatten() })
    return
  }

  const id = req.params.id

  // Default range: last 30 days
  const now = new Date()
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const from = parsed.data.from ?? defaultFrom.toISOString()
  const to = parsed.data.to ?? now.toISOString()

  // Verify KOL exists & grab commission_rate
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

  // --- Clicks + unique_visitors --------------------------------------------
  // Fetch click rows (user_id + ip_hash) in range; aggregate in JS because
  // PostgREST cannot express COUNT(DISTINCT COALESCE(user_id, ip_hash)).
  const { data: clickRows, error: clicksErr } = await supabase
    .from("kol_clicks")
    .select("user_id, ip_hash")
    .eq("kol_id", id)
    .gte("clicked_at", from)
    .lte("clicked_at", to)

  if (clicksErr) {
    res.status(500).json({ error: clicksErr.message })
    return
  }

  const clicks = clickRows?.length ?? 0
  const visitorSet = new Set<string>()
  for (const row of clickRows ?? []) {
    const r = row as { user_id: string | null; ip_hash: string | null }
    const key = r.user_id ?? r.ip_hash ?? `anon:${visitorSet.size}`
    visitorSet.add(key)
  }
  const unique_visitors = visitorSet.size

  // --- Orders + revenue (id + total for downstream item lookup) ------------
  const { data: orderRows, error: ordersErr } = await supabase
    .from("orders")
    .select("id, total")
    .eq("attributed_kol_id", id)
    .gte("created_at", from)
    .lte("created_at", to)

  if (ordersErr) {
    res.status(500).json({ error: ordersErr.message })
    return
  }

  const orders = orderRows?.length ?? 0
  const total_revenue = (orderRows ?? []).reduce(
    (sum, r) => sum + Number((r as { total: number | string }).total ?? 0),
    0,
  )
  const orderIds = (orderRows ?? []).map((r) => (r as { id: string }).id)

  const conversion_rate =
    clicks > 0 ? Math.round((orders / clicks) * 10000) / 100 : 0
  const avg_order_value =
    orders > 0 ? Math.round((total_revenue / orders) * 100) / 100 : 0
  const rate = Number(kol.commission_rate ?? 0)
  const est_commission = Math.round(total_revenue * rate) / 100

  // --- Top products --------------------------------------------------------
  // Aggregate order_items for the attributed orders. product_id lives on
  // product_variants; name is in product_snapshot.name (set at order time).
  type TopProductAgg = {
    product_id: string | null
    name: string
    qty_sold: number
    revenue: number
  }
  let top_products: TopProductAgg[] = []

  if (orderIds.length > 0) {
    const { data: itemRows, error: itemsErr } = await supabase
      .from("order_items")
      .select(
        "qty, unit_price, product_snapshot, variant_id, product_variants(product_id)",
      )
      .in("order_id", orderIds)

    if (itemsErr) {
      res.status(500).json({ error: itemsErr.message })
      return
    }

    const byProduct = new Map<string, TopProductAgg>()
    for (const raw of itemRows ?? []) {
      const it = raw as unknown as {
        qty: number | string
        unit_price: number | string
        product_snapshot: { name?: string } | null
        variant_id: string | null
        product_variants: { product_id: string } | { product_id: string }[] | null
      }
      // PostgREST may return joined row as array or object depending on relation
      const pv = Array.isArray(it.product_variants)
        ? it.product_variants[0]
        : it.product_variants
      const productId = pv?.product_id ?? null
      const key = productId ?? `variant:${it.variant_id ?? "unknown"}`
      const name = it.product_snapshot?.name ?? "(未命名商品)"
      const qty = Number(it.qty ?? 0)
      const revenue = qty * Number(it.unit_price ?? 0)
      const cur = byProduct.get(key)
      if (cur) {
        cur.qty_sold += qty
        cur.revenue += revenue
      } else {
        byProduct.set(key, {
          product_id: productId,
          name,
          qty_sold: qty,
          revenue,
        })
      }
    }
    top_products = Array.from(byProduct.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
  }

  res.json({
    data: {
      kol_id: id,
      slug: kol.slug,
      name: kol.name,
      from,
      to,
      clicks,
      unique_visitors,
      orders,
      conversion_rate,
      total_revenue,
      avg_order_value,
      est_commission,
      top_products,
    },
  })
})
