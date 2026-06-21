import { Router } from "express"
import { randomUUID } from "node:crypto"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { z } from "zod"

export const categoriesRouter = Router()
export const categoriesAdminRouter = Router()

const slugRegex = /^[a-z0-9-]+$/

const categoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(slugRegex).optional().or(z.literal("")),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().nonnegative().optional(),
})

const categoryUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().regex(slugRegex).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().nonnegative().optional(),
})

function autoSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "")
    .replace(/_+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (base.length > 0) return base
  return `cat-${randomUUID().slice(0, 8)}`
}

function buildTree(rows: any[]): any[] {
  const map = new Map(rows.map(r => [r.id, { ...r, children: [] }]))
  const roots: any[] = []
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

// GET /categories — public
categoriesRouter.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, parent_id, sort_order")
    .order("sort_order", { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }

  const rows = data ?? []

  // product_count per category — counts only ACTIVE (上架) products, matching
  // the storefront's own visibility filter (/products uses is_active=true). The
  // Header hides categories with 0 products; before this field every
  // product_count was undefined, so `(product_count ?? 0) > 0` filtered out
  // EVERY category and the 商品選購 dropdown rendered empty.
  const counts = new Map<string, number>()
  const ids = rows.map((r) => r.id)
  if (ids.length > 0) {
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("category_id")
      .eq("is_active", true)
      .in("category_id", ids)
    if (prodErr) { res.status(500).json({ error: prodErr.message }); return }
    for (const p of products ?? []) {
      if (!p.category_id) continue
      counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1)
    }
  }

  const enriched = rows.map((r) => ({ ...r, product_count: counts.get(r.id) ?? 0 }))
  res.json({ data: buildTree(enriched) })
})

// GET /categories/:slug — public, full landing data (banner + tagline + features + related posts)
categoriesRouter.get("/:slug", async (req, res) => {
  const { data: category, error: catErr } = await supabase
    .from("categories")
    .select("*")
    .eq("slug", req.params.slug)
    .maybeSingle()
  if (catErr) { res.status(500).json({ error: catErr.message }); return }
  if (!category) { res.status(404).json({ error: "Category not found" }); return }

  // Fetch related posts: explicit slugs if provided, else recent 4 (any post)
  let posts: any[] = []
  const relatedSlugs: string[] = Array.isArray((category as any).related_post_slugs)
    ? (category as any).related_post_slugs
    : []

  if (relatedSlugs.length > 0) {
    const { data, error: postsErr } = await supabase
      .from("posts")
      .select("slug, title, excerpt, cover_image, published_at")
      .in("slug", relatedSlugs)
      .limit(4)
    if (postsErr) { res.status(500).json({ error: postsErr.message }); return }
    posts = data ?? []
  } else {
    // Fallback: most recent 4 posts (simple v1; v2 could match by category)
    const { data, error: postsErr } = await supabase
      .from("posts")
      .select("slug, title, excerpt, cover_image, published_at")
      .order("published_at", { ascending: false })
      .limit(4)
    if (postsErr) { res.status(500).json({ error: postsErr.message }); return }
    posts = data ?? []
  }

  res.json({ category, posts })
})

// POST /categories — admin only (legacy path; kept for back-compat)
categoriesRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = categoryCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const payload = { ...parsed.data, slug: parsed.data.slug && parsed.data.slug.length > 0 ? parsed.data.slug : autoSlug(parsed.data.name) }

  const { data, error } = await supabase
    .from("categories")
    .insert(payload)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// PUT /categories/:id — admin only (legacy path; kept for back-compat)
categoriesRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = categoryUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("categories")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Category not found" }); return }
  res.json({ data })
})

// DELETE /categories/:id — admin only (legacy path; kept for back-compat)
categoriesRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// ---------- /admin/categories ----------

// GET /admin/categories — list with product_count + campaign_count
categoriesAdminRouter.get("/", requireAuth, requireEditor, async (_req, res) => {
  const { data: categories, error } = await supabase
    .from("categories")
    .select("id, name, slug, parent_id, sort_order, created_at")
    .order("sort_order", { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  const rows = categories ?? []

  // product_count: COUNT(products) GROUP BY category_id
  const ids = rows.map(r => r.id)
  let productCounts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("category_id")
      .in("category_id", ids)
    if (prodErr) { res.status(500).json({ error: prodErr.message }); return }
    for (const p of products ?? []) {
      if (!p.category_id) continue
      productCounts.set(p.category_id, (productCounts.get(p.category_id) ?? 0) + 1)
    }
  }

  // campaign_count: COUNT(campaigns) WHERE config->>'category_slug' = slug
  const slugCampaignCounts = new Map<string, number>()
  const slugs = rows.map(r => r.slug)
  if (slugs.length > 0) {
    const { data: campaigns, error: campErr } = await supabase
      .from("campaigns")
      .select("id, config")
      .in("config->>category_slug", slugs)
    if (campErr) { res.status(500).json({ error: campErr.message }); return }
    for (const c of campaigns ?? []) {
      const cfg = (c as any).config
      const cs = cfg && typeof cfg === "object" ? cfg.category_slug : null
      if (!cs) continue
      slugCampaignCounts.set(cs, (slugCampaignCounts.get(cs) ?? 0) + 1)
    }
  }

  const enriched = rows.map(r => ({
    ...r,
    product_count: productCounts.get(r.id) ?? 0,
    campaign_count: slugCampaignCounts.get(r.slug) ?? 0,
  }))

  res.json({ data: enriched })
})

// POST /admin/categories — create
categoriesAdminRouter.post("/", requireAuth, requireAdmin, async (req, res) => {
  const parsed = categoryCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const slug = parsed.data.slug && parsed.data.slug.length > 0 ? parsed.data.slug : autoSlug(parsed.data.name)
  const payload: Record<string, any> = {
    name: parsed.data.name,
    slug,
    parent_id: parsed.data.parent_id ?? null,
    sort_order: parsed.data.sort_order ?? 0,
  }

  const { data, error } = await supabase
    .from("categories")
    .insert(payload)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// PUT /admin/categories/:id — partial update; reject self-parent + cycles (parent must be top-level)
categoriesAdminRouter.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = categoryUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  if (parsed.data.parent_id && parsed.data.parent_id === req.params.id) {
    res.status(400).json({ error: "Category cannot be its own parent" }); return
  }

  // If parent_id set, ensure the parent itself is top-level (no 3rd-level nesting)
  if (parsed.data.parent_id) {
    const { data: parent, error: parentErr } = await supabase
      .from("categories")
      .select("id, parent_id")
      .eq("id", parsed.data.parent_id)
      .maybeSingle()
    if (parentErr) { res.status(500).json({ error: parentErr.message }); return }
    if (!parent) { res.status(400).json({ error: "Parent category not found" }); return }
    if (parent.parent_id) { res.status(400).json({ error: "Cannot nest categories beyond 2 levels" }); return }
  }

  const { data, error } = await supabase
    .from("categories")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Category not found" }); return }
  res.json({ data })
})

// DELETE /admin/categories/:id — protected: block if children / products / campaigns reference it
categoriesAdminRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id

  // Fetch the category first to know its slug (for campaign lookup)
  const { data: cat, error: fetchErr } = await supabase
    .from("categories")
    .select("id, slug")
    .eq("id", id)
    .maybeSingle()
  if (fetchErr) { res.status(500).json({ error: fetchErr.message }); return }
  if (!cat) { res.status(404).json({ error: "Category not found" }); return }

  // (a) children
  const { count: childCount, error: childErr } = await supabase
    .from("categories")
    .select("id", { head: true, count: "exact" })
    .eq("parent_id", id)
  if (childErr) { res.status(500).json({ error: childErr.message }); return }

  // (b) products
  const { count: productCount, error: prodErr } = await supabase
    .from("products")
    .select("id", { head: true, count: "exact" })
    .eq("category_id", id)
  if (prodErr) { res.status(500).json({ error: prodErr.message }); return }

  // (c) campaigns referencing this slug via config->>category_slug
  const { count: campaignCount, error: campErr } = await supabase
    .from("campaigns")
    .select("id", { head: true, count: "exact" })
    .eq("config->>category_slug", cat.slug)
  if (campErr) { res.status(500).json({ error: campErr.message }); return }

  const children = childCount ?? 0
  const products = productCount ?? 0
  const campaigns = campaignCount ?? 0

  if (children > 0 || products > 0 || campaigns > 0) {
    res.status(409).json({
      error: "Category is in use",
      detail: { children, products, campaigns },
    })
    return
  }

  const { error: delErr } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
  if (delErr) { res.status(500).json({ error: delErr.message }); return }
  res.status(204).send()
})
