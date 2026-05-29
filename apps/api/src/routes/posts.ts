import { Router } from "express"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { z } from "zod"

export const postsPublicRouter = Router()
export const postsAdminRouter = Router()

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const postSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/).optional(),
  content_html: z.string().optional(),
  excerpt: z.string().optional(),
  cover_image: z.string().url().optional().nullable(),
  status: z.enum(["draft", "published", "scheduled"]).optional(),
  category_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string().uuid()).optional(),
  seo_title: z.string().optional().nullable(),
  seo_description: z.string().optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
})

const postUpdateSchema = postSchema.partial()

// GET /posts — public, paginated
postsPublicRouter.get("/", async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10))
  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from("posts")
    .select("id, title, slug, excerpt, cover_image, published_at, created_at, category_id, author_id, post_categories(name, slug)", { count: "exact" })
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, to)

  // Public only sees published by default
  const status = req.query.status as string | undefined
  if (status === "published" || !status) {
    query = query.eq("status", "published")
  }

  if (req.query.category) {
    // Filter by category name or slug
    const catParam = req.query.category as string
    let cat: { id: string } | null = null
    // Try by name first, then by slug
    const { data: catByName } = await supabase
      .from("post_categories")
      .select("id")
      .eq("name", catParam)
      .single()
    cat = catByName
    if (!cat) {
      const { data: catBySlug } = await supabase
        .from("post_categories")
        .select("id")
        .eq("slug", catParam)
        .single()
      cat = catBySlug
    }
    if (cat) {
      query = query.eq("category_id", cat.id)
    } else {
      res.json({ data: [], total: 0 }); return
    }
  }

  if (req.query.tag) {
    // Filter by tag slug — look up post IDs via post_tag_links
    const { data: tag } = await supabase
      .from("post_tags")
      .select("id")
      .eq("slug", req.query.tag as string)
      .single()
    if (tag) {
      const { data: links } = await supabase
        .from("post_tag_links")
        .select("post_id")
        .eq("tag_id", tag.id)
      const postIds = (links ?? []).map(l => l.post_id)
      if (postIds.length === 0) {
        res.json({ data: [], total: 0 }); return
      }
      query = query.in("id", postIds)
    } else {
      res.json({ data: [], total: 0 }); return
    }
  }

  const { data, error, count } = await query
  if (error) { res.status(500).json({ error: error.message }); return }

  // Resolve author display names in batch
  const authorIds = [...new Set((data ?? []).map((r: any) => r.author_id).filter(Boolean))]
  let authorMap: Record<string, string> = {}
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name")
      .in("user_id", authorIds)
    for (const p of profiles ?? []) {
      if (p.display_name) authorMap[p.user_id] = p.display_name
    }
  }

  // Flatten joined relations into the shape the frontend expects
  const posts = (data ?? []).map((row: any) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    cover_image: row.cover_image,
    published_at: row.published_at,
    created_at: row.created_at,
    category: row.post_categories?.name ?? null,
    author: (row.author_id && authorMap[row.author_id]) || null,
  }))

  const total = count ?? 0
  res.json({ data: posts, total })
})

// GET /posts/:slug — public, single post by slug, only published
postsPublicRouter.get("/:slug", async (req, res) => {
  const { data, error } = await supabase
    .from("posts")
    .select(`
      id, title, slug, content_html, excerpt, cover_image, status, category_id,
      published_at, seo_title, seo_description, scheduled_at, created_at, updated_at,
      post_categories(name, slug)
    `)
    .eq("slug", req.params.slug)
    .eq("status", "published")
    .single()

  const err = error as { code?: string; message?: string } | null
  if (!data || (err && err.code === "PGRST116")) {
    res.status(404).json({ error: "Post not found" }); return
  }
  if (err) { res.status(500).json({ error: err.message }); return }

  // Fetch tags for this post
  const { data: tagLinks } = await supabase
    .from("post_tag_links")
    .select("tag_id, post_tags(id, name, slug)")
    .eq("post_id", data.id)

  // Resolve author display name
  const row = data as any
  let authorName: string | null = null
  if (row.author_id) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name")
      .eq("user_id", row.author_id)
      .single()
    authorName = profile?.display_name ?? null
  }

  res.json({
    data: {
      id: row.id,
      title: row.title,
      slug: row.slug,
      content_html: row.content_html,
      excerpt: row.excerpt,
      cover_image: row.cover_image,
      published_at: row.published_at,
      category: row.post_categories?.name ?? null,
      author: authorName,
      seo_title: row.seo_title,
      seo_description: row.seo_description,
      created_at: row.created_at,
      tags: (tagLinks ?? []).map(l => (l as any).post_tags),
    },
  })
})

// POST /admin/posts — requireAuth + requireEditor
// GET /admin/posts — list ALL posts (any status) for the admin grid
postsAdminRouter.get("/", requireAuth, requireEditor, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  const from = (page - 1) * limit
  const to = from + limit - 1
  let query = supabase
    .from("posts")
    .select("id, title, slug, status, published_at, created_at, category_id, author_id, post_categories(name)", { count: "exact" })
    .order("created_at", { ascending: false, nullsFirst: false })
    .range(from, to)
  const status = req.query.status as string | undefined
  if (status && ["draft", "published", "scheduled"].includes(status)) {
    query = query.eq("status", status)
  }
  const { data, error, count } = await query
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [], total: count ?? 0, page, limit })
})

// GET /admin/posts/:id — fetch single post (any status) for the editor
postsAdminRouter.get("/:id", requireAuth, requireEditor, async (req, res) => {
  const { data, error } = await supabase
    .from("posts")
    .select("*, post_categories(name)")
    .eq("id", req.params.id)
    .single()
  if (error || !data) { res.status(404).json({ error: "Post not found" }); return }
  res.json({ data })
})

postsAdminRouter.post("/", requireAuth, requireEditor, async (req, res) => {
  const parsed = postSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { tags, ...postData } = parsed.data
  if (!postData.slug) {
    postData.slug = slugify(postData.title)
  }

  const { data, error } = await supabase
    .from("posts")
    .insert({ ...postData, author_id: res.locals.userId })
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }

  // Insert tag links if provided
  if (tags && tags.length > 0 && data) {
    const tagLinks = tags.map(tag_id => ({ post_id: data.id, tag_id }))
    await supabase.from("post_tag_links").insert(tagLinks)
  }

  res.status(201).json({ data })
})

// PUT /admin/posts/:id — requireAuth + requireEditor
postsAdminRouter.put("/:id", requireAuth, requireEditor, async (req, res) => {
  const parsed = postUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { tags, ...postData } = parsed.data

  const { data, error } = await supabase
    .from("posts")
    .update(postData)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Post not found" }); return }

  // Update tag links if provided
  if (tags !== undefined) {
    await supabase.from("post_tag_links").delete().eq("post_id", req.params.id)
    if (tags.length > 0) {
      const tagLinks = tags.map(tag_id => ({ post_id: data.id, tag_id }))
      await supabase.from("post_tag_links").insert(tagLinks)
    }
  }

  res.json({ data })
})

// DELETE /admin/posts/:id — requireAuth + requireAdmin (admin only)
postsAdminRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})
