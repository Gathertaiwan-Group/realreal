import { Router } from "express"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { z } from "zod"

export const productsRouter = Router()
export const productsAdminRouter = Router()

const productSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  excerpt: z.string().optional(),
  category_id: z.string().uuid().nullable().optional(),
  images: z.array(z.object({
    url: z.string().url(),
    alt: z.string().optional(),
    sort_order: z.number().int().nonnegative(),
  })).optional(),
  is_active: z.boolean().optional(),
})

// Helper: enrich products with prices, total_stock, and flatten image URLs
async function enrichProducts(products: any[]) {
  if (products.length === 0) return products

  const productIds = products.map((p) => p.id)
  const { data: variants } = await supabase
    .from("product_variants")
    .select("product_id, price, stock_qty")
    .in("product_id", productIds)

  const statsMap = new Map<string, { min_price: number | null; max_price: number | null; total_stock: number }>()
  for (const v of variants ?? []) {
    const entry = statsMap.get(v.product_id)
    const price = Number(v.price)
    const stock = Number(v.stock_qty) || 0
    if (!entry) {
      statsMap.set(v.product_id, { min_price: price, max_price: price, total_stock: stock })
    } else {
      if (entry.min_price === null || price < entry.min_price) entry.min_price = price
      if (entry.max_price === null || price > entry.max_price) entry.max_price = price
      entry.total_stock += stock
    }
  }

  return products.map((p) => {
    const stats = statsMap.get(p.id)
    // Flatten images: DB stores {url, alt, sort_order}[] — extract just the URL strings
    let images: string[] | null = null
    if (Array.isArray(p.images) && p.images.length > 0) {
      if (typeof p.images[0] === "string") {
        images = p.images
      } else {
        const sorted = [...p.images].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        images = sorted.map((img: any) => img.url).filter(Boolean)
      }
    }
    return {
      ...p,
      images,
      min_price: stats?.min_price ?? null,
      max_price: stats?.max_price ?? null,
      total_stock: stats?.total_stock ?? 0,
    }
  })
}

// GET /products — public, paginated
productsRouter.get("/", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const from = (page - 1) * limit
  const to = from + limit - 1

  // Resolve category slug to category_id when the param is not a UUID
  let categoryId: string | undefined
  if (req.query.category) {
    const cat = req.query.category as string
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cat)
    if (isUUID) {
      categoryId = cat
    } else {
      const { data: catRow } = await supabase
        .from("categories")
        .select("id")
        .eq("slug", cat)
        .single()
      if (catRow) categoryId = catRow.id
    }
  }

  let query = supabase
    .from("products")
    .select("id, name, slug, description, category_id, images, is_active, is_featured, display_priority, created_at", { count: "exact" })
    .eq("is_active", true)
    .order("is_featured", { ascending: false })
    .order("display_priority", { ascending: false })
    .order("created_at", { ascending: false })

  if (categoryId) query = query.eq("category_id", categoryId)
  if (req.query.featured_only === "true") query = query.eq("is_featured", true)
  if (req.query.q) {
    query = query.textSearch("search_vector", req.query.q as string, { type: "plain", config: "simple" })
  }

  const sort = req.query.sort as string | undefined

  // For price sorting we need all matching products first, then sort & paginate
  if (sort === "price_asc" || sort === "price_desc") {
    const { data: allData, error: allError, count: allCount } = await query
    if (allError) { res.status(500).json({ error: allError.message }); return }

    const enriched = await enrichProducts(allData ?? [])
    enriched.sort((a, b) => {
      const pa = a.min_price ?? 0
      const pb = b.min_price ?? 0
      return sort === "price_asc" ? pa - pb : pb - pa
    })

    const paginated = enriched.slice(from, to + 1)
    res.json({ data: paginated, total: allCount ?? 0 })
    return
  }

  query = query.range(from, to)
  const { data, error, count } = await query
  if (error) { res.status(500).json({ error: error.message }); return }

  const enriched = await enrichProducts(data ?? [])
  res.json({ data: enriched, total: count ?? 0 })
})

// GET /products/:slug — public
productsRouter.get("/:slug", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select(`
      id, name, slug, description, excerpt, category_id, images, is_active, created_at,
      product_variants (id, sku, name, price, sale_price, stock_qty, weight, attributes)
    `)
    .eq("slug", req.params.slug)
    .single()

  const err = error as { code?: string; message?: string } | null
  if (!data || (err && err.code === "PGRST116")) {
    res.status(404).json({ error: "Product not found" }); return
  }
  if (err) { res.status(500).json({ error: err.message }); return }

  // Remap product_variants -> variants for frontend compatibility
  const { product_variants, ...rest } = data as typeof data & { product_variants?: unknown[] }

  // Flatten images: DB stores {url, alt, sort_order}[] — extract just the URL strings
  let images: string[] | null = null
  if (Array.isArray(rest.images) && rest.images.length > 0) {
    if (typeof rest.images[0] === "string") {
      images = rest.images as string[]
    } else {
      const sorted = [...(rest.images as any[])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      images = sorted.map((img: any) => img.url).filter(Boolean)
    }
  }

  res.json({ data: { ...rest, images, variants: product_variants ?? [] } })
})

// POST /products — admin only
productsRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = productSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("products")
    .insert(parsed.data)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// PUT /products/:id — admin only
productsRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = productSchema.partial().safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("products")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Product not found" }); return }
  res.json({ data })
})

// DELETE /products/:id — admin only
productsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin endpoints — display control (Spec B Section 2)
// Mounted at /admin/products in app.ts
// ─────────────────────────────────────────────────────────────────────────────

const featureSchema = z.object({
  is_featured: z.boolean(),
  display_priority: z.number().int().min(0).max(99999).optional(),
})

// PATCH /admin/products/:id/feature — toggle featured flag (+ optional priority)
productsAdminRouter.patch("/:id/feature", requireAuth, requireEditor, async (req, res) => {
  const parsed = featureSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const update: { is_featured: boolean; display_priority?: number } = {
    is_featured: parsed.data.is_featured,
  }
  if (parsed.data.display_priority !== undefined) update.display_priority = parsed.data.display_priority

  const { data, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Product not found" }); return }
  res.json({ data })
})

const reorderSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    display_priority: z.number().int().min(0).max(99999),
  })).min(1),
})

// POST /admin/products/reorder — batch update display_priority for many products
productsAdminRouter.post("/reorder", requireAuth, requireEditor, async (req, res) => {
  const parsed = reorderSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const updated: any[] = []
  for (const item of parsed.data.items) {
    const { data, error } = await supabase
      .from("products")
      .update({ display_priority: item.display_priority })
      .eq("id", item.id)
      .select("id, display_priority")
      .single()
    if (error) { res.status(500).json({ error: error.message }); return }
    if (data) updated.push(data)
  }

  res.json({ data: updated })
})
