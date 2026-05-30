import { Router } from "express"
import { randomUUID } from "node:crypto"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { z } from "zod"

export const postCategoriesPublicRouter = Router()
export const postCategoriesAdminRouter = Router()

const slugRegex = /^[a-z0-9-]+$/

// Per spec A pattern: name required, slug optional (auto-gen if empty)
const postCategoryCreateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(slugRegex).optional().or(z.literal("")),
  description: z.string().optional().nullable(),
})

const postCategoryUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().regex(slugRegex).optional(),
  description: z.string().optional().nullable(),
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
  return `post-cat-${randomUUID().slice(0, 8)}`
}

// GET /post-categories — public list
postCategoriesPublicRouter.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("post_categories")
    .select("id, name, slug, description, created_at")
    .order("name", { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})

// ---------- /admin/post-categories ----------

// GET /admin/post-categories — list with post_count (COUNT(posts) GROUP BY category_id)
postCategoriesAdminRouter.get("/", requireAuth, requireEditor, async (_req, res) => {
  const { data: categories, error } = await supabase
    .from("post_categories")
    .select("id, name, slug, description, created_at")
    .order("created_at", { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  const rows = categories ?? []

  // post_count: COUNT(posts) GROUP BY category_id
  const ids = rows.map(r => r.id)
  const postCounts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: posts, error: postErr } = await supabase
      .from("posts")
      .select("category_id")
      .in("category_id", ids)
    if (postErr) { res.status(500).json({ error: postErr.message }); return }
    for (const p of posts ?? []) {
      if (!p.category_id) continue
      postCounts.set(p.category_id, (postCounts.get(p.category_id) ?? 0) + 1)
    }
  }

  const enriched = rows.map(r => ({
    ...r,
    post_count: postCounts.get(r.id) ?? 0,
  }))

  res.json({ data: enriched })
})

// POST /admin/post-categories — requireEditor
postCategoriesAdminRouter.post("/", requireAuth, requireEditor, async (req, res) => {
  const parsed = postCategoryCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const slug = parsed.data.slug && parsed.data.slug.length > 0 ? parsed.data.slug : autoSlug(parsed.data.name)
  const payload: Record<string, any> = {
    name: parsed.data.name,
    slug,
    description: parsed.data.description ?? null,
  }

  const { data, error } = await supabase
    .from("post_categories")
    .insert(payload)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// PUT /admin/post-categories/:id — requireEditor
postCategoriesAdminRouter.put("/:id", requireAuth, requireEditor, async (req, res) => {
  const parsed = postCategoryUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("post_categories")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Post category not found" }); return }
  res.json({ data })
})

// DELETE /admin/post-categories/:id — requireAdmin; block if any posts reference it (409)
postCategoriesAdminRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id

  // Verify category exists
  const { data: cat, error: fetchErr } = await supabase
    .from("post_categories")
    .select("id")
    .eq("id", id)
    .maybeSingle()
  if (fetchErr) { res.status(500).json({ error: fetchErr.message }); return }
  if (!cat) { res.status(404).json({ error: "Post category not found" }); return }

  // Block delete if any posts reference this category
  const { count: postCount, error: postErr } = await supabase
    .from("posts")
    .select("id", { head: true, count: "exact" })
    .eq("category_id", id)
  if (postErr) { res.status(500).json({ error: postErr.message }); return }

  const posts = postCount ?? 0
  if (posts > 0) {
    res.status(409).json({
      error: "Post category is in use",
      detail: { posts },
    })
    return
  }

  const { error: delErr } = await supabase
    .from("post_categories")
    .delete()
    .eq("id", id)
  if (delErr) { res.status(500).json({ error: delErr.message }); return }
  res.status(204).send()
})
