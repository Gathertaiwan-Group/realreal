import { Router } from "express"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { enrichProducts } from "../lib/enrich-products"
import { z } from "zod"

export const productsRouter = Router()
export const productsAdminRouter = Router()

const productSchema = z.object({
  name: z.string().min(1),
  // Allow underscores too: legacy products imported from WordPress have slugs
  // like "peach_apple" / "canvabag_s" (and "__trashed" duplicates). The strict
  // hyphen-only pattern 400-ed EVERY edit of those products (the form re-sends
  // the existing slug). Underscores are URL-safe and already served live by
  // GET /products/:slug — same legacy-data fix as the images.url refine below.
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  description: z.string().optional(),
  excerpt: z.string().optional(),
  category_id: z.string().uuid().nullable().optional(),
  images: z.array(z.object({
    // Accept absolute http(s) URLs (Supabase public URLs) OR root-relative
    // paths (legacy data already stored as "/uploads/...."). Strict .url()
    // rejected relative paths, 400-ing every edit of older products. Empty
    // strings are still rejected — the admin UI strips blanks before sending.
    url: z.string().trim().min(1).refine(
      (v) => /^https?:\/\//.test(v) || v.startsWith("/"),
      { message: "Invalid URL" },
    ),
    alt: z.string().optional(),
    sort_order: z.number().int().nonnegative(),
  })).optional(),
  is_active: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  is_addon: z.boolean().optional(),
  is_recommended: z.boolean().optional(),
  display_priority: z.number().int().min(0).max(99999).optional(),
  min_tier_id: z.string().uuid().nullable().optional(),
})

const nestedVariantSchema = z.object({
  sku: z.string().max(100).optional(),
  name: z.string().min(1),
  price: z.number().positive(),
  sale_price: z.number().positive().nullable().optional(),
  // addon_price = 加購價 (variant-level add-on price), nullable column.
  addon_price: z.number().positive().nullable().optional(),
  // addon_limit = 加購數量上限 (first N units at add-on price). Default 1.
  addon_limit: z.number().int().positive().optional(),
  stock_qty: z.number().int().nonnegative(),
  weight: z.number().nonnegative().nullable().optional(),
  attributes: z.record(z.string(), z.string()).nullable().optional(),
}).refine(
  (variant) => variant.sale_price == null || variant.sale_price <= variant.price,
  { message: "Sale price cannot exceed regular price", path: ["sale_price"] },
).refine(
  // Admin-UX guard: add-on price must not exceed the regular price.
  // Runtime enforcement lives in orders.ts.
  (variant) => variant.addon_price == null || variant.addon_price <= variant.price,
  { message: "加購價不可高於原價", path: ["addon_price"] },
)

const nestedProductCreateSchema = z.object({
  product: productSchema,
  variants: z.array(nestedVariantSchema).min(1),
})

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
    .select("id, name, slug, description, category_id, images, is_active, is_featured, is_addon, is_recommended, display_priority, created_at, min_tier_id, membership_tiers!min_tier_id(id, name, min_spend), product_variants(id, sku, name, price, sale_price, addon_price, addon_limit, stock_qty)", { count: "exact" })
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("is_featured", { ascending: false })
    .order("display_priority", { ascending: false })
    .order("created_at", { ascending: false })

  if (categoryId) query = query.eq("category_id", categoryId)
  if (req.query.featured_only === "true") query = query.eq("is_featured", true)
  if (req.query.is_addon === "true") query = query.eq("is_addon", true)
  if (req.query.is_recommended === "true") query = query.eq("is_recommended", true)
  if (req.query.q) {
    query = query.textSearch("search_vector", req.query.q as string, { type: "plain", config: "simple" })
  }
  // Spec E Section 5 — substring match on name for ProductPicker autocomplete
  if (typeof req.query.search === "string") {
    const s = req.query.search.trim()
    if (s) query = query.ilike("name", `%${s}%`)
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
      id, name, slug, description, excerpt, category_id, images, is_active, created_at, min_tier_id,
      membership_tiers!min_tier_id(id, name, min_spend),
      product_variants (id, sku, name, price, sale_price, addon_price, addon_limit, stock_qty, weight, attributes)
    `)
    .eq("slug", req.params.slug)
    .is("deleted_at", null)
    .single()

  const err = error as { code?: string; message?: string } | null
  if (!data || (err && err.code === "PGRST116")) {
    res.status(404).json({ error: "Product not found" }); return
  }
  if (err) { res.status(500).json({ error: err.message }); return }

  // Remap product_variants -> variants, membership_tiers -> min_tier for frontend compatibility
  const { product_variants, membership_tiers: minTierRaw, ...rest } = data as typeof data & { product_variants?: unknown[]; membership_tiers?: unknown }

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

  res.json({ data: { ...rest, images, variants: product_variants ?? [], min_tier: minTierRaw ?? null } })
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

// DELETE /products/:id — admin only.
// Default = soft delete (封存): set deleted_at + is_active=false.
// ?hard=true = permanent delete, but refused (409) if any variant is still
// referenced by order_items / subscription_plans (those FKs do NOT cascade).
productsRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  if (req.query.hard === "true") {
    // Fetch this product's variant ids first.
    const { data: variants, error: variantsError } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", req.params.id)
    if (variantsError) { res.status(500).json({ error: variantsError.message }); return }

    const variantIds = (variants ?? []).map((v) => v.id)
    if (variantIds.length > 0) {
      // Any historical order referencing these variants?
      const { data: orderRef, error: orderError } = await supabase
        .from("order_items")
        .select("id")
        .in("variant_id", variantIds)
        .limit(1)
      if (orderError) { res.status(500).json({ error: orderError.message }); return }

      // Any subscription plan referencing these variants?
      const { data: planRef, error: planError } = await supabase
        .from("subscription_plans")
        .select("id")
        .in("variant_id", variantIds)
        .limit(1)
      if (planError) { res.status(500).json({ error: planError.message }); return }

      if ((orderRef && orderRef.length > 0) || (planRef && planRef.length > 0)) {
        res.status(409).json({ error: "此商品有歷史訂單或訂閱方案引用，無法永久刪除，請改用封存" })
        return
      }
    }

    // Safe to hard delete — CASCADE clears variants + reviews.
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id)
    if (error) { res.status(500).json({ error: error.message }); return }
    res.status(200).json({ ok: true, mode: "deleted" })
    return
  }

  // Soft delete (default): archive the product.
  const { error } = await supabase
    .from("products")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", req.params.id)
    .is("deleted_at", null)
  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(200).json({ ok: true, mode: "archived" })
})

// ─────────────────────────────────────────────────────────────────────────────
// Admin endpoints — display control (Spec B Section 2)
// Mounted at /admin/products in app.ts
// ─────────────────────────────────────────────────────────────────────────────

// POST /admin/products — create a product and all variants in one workflow.
productsAdminRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = nestedProductCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() })
    return
  }

  const seenSkus = new Set<string>()
  for (const variant of parsed.data.variants) {
    const sku = variant.sku?.trim().toUpperCase()
    if (!sku) continue
    if (seenSkus.has(sku)) {
      res.status(400).json({ error: `Duplicate SKU: ${sku}` })
      return
    }
    seenSkus.add(sku)
  }

  const productPayload = {
    ...parsed.data.product,
    category_id: parsed.data.product.category_id ?? null,
  }
  const { data: product, error: productError } = await supabase
    .from("products")
    .insert(productPayload)
    .select()
    .single()

  if (productError || !product) {
    res.status(500).json({ error: productError?.message ?? "Failed to create product" })
    return
  }

  const variantsPayload = parsed.data.variants.map((variant) => ({
    ...variant,
    sku: variant.sku?.trim() || null,
    product_id: product.id,
  }))
  const { data: variants, error: variantsError } = await supabase
    .from("product_variants")
    .insert(variantsPayload)
    .select()

  if (variantsError) {
    const { error: rollbackError } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id)
    res.status(500).json({
      error: "Failed to create product variants",
      details: variantsError.message,
      rollback_failed: Boolean(rollbackError),
    })
    return
  }

  res.status(201).json({ data: { product, variants: variants ?? [] } })
})

// POST /admin/products/:id/restore — un-archive a product (清除 deleted_at).
// is_active is left as-is (stays false), so a restored product stays 下架
// until the admin republishes it.
productsAdminRouter.post("/:id/restore", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("products")
    .update({ deleted_at: null })
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(200).json({ ok: true })
})

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

// PATCH /admin/products/:id/toggle — flip is_active / is_addon / is_recommended.
// Lightweight partial update for the edit page's auto-save switches: the
// payload is tiny so it never trips the images/variants validation that the
// full PUT enforces. At least one field is required.
const toggleSchema = z
  .object({
    is_active: z.boolean().optional(),
    is_addon: z.boolean().optional(),
    is_recommended: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.is_active !== undefined ||
      v.is_addon !== undefined ||
      v.is_recommended !== undefined,
    { message: "At least one of is_active / is_addon / is_recommended is required" },
  )

productsAdminRouter.patch("/:id/toggle", requireAuth, requireEditor, async (req, res) => {
  const parsed = toggleSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("products")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select("id, is_active, is_addon, is_recommended")
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
