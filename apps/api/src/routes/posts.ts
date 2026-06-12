import { Router } from "express"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { z } from "zod"

export const postsPublicRouter = Router()
export const postsAdminRouter = Router()

// Unicode-aware: keeps CJK so Chinese titles/tags get a usable slug instead of
// collapsing to an empty string (\w would strip every Chinese character).
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Accepts either an array of tag UUIDs or a comma-separated string of tag names
// (what the admin PostForm sends). Names are find-or-created in post_tags so the
// free-text tag input actually persists. Resilient: a failed tag is skipped, not
// fatal to the whole save.
async function resolveTagIds(
  tags: string[] | string | null | undefined,
): Promise<string[]> {
  if (tags == null) return []
  if (Array.isArray(tags)) return tags
  const names = [...new Set(tags.split(",").map((t) => t.trim()).filter(Boolean))]
  const ids: string[] = []
  for (const name of names) {
    const { data: found } = await supabase
      .from("post_tags")
      .select("id")
      .eq("name", name)
      .maybeSingle()
    if (found) {
      ids.push(found.id)
      continue
    }
    const { data: created } = await supabase
      .from("post_tags")
      .insert({ name, slug: slugify(name) || name })
      .select("id")
      .single()
    if (created) ids.push(created.id)
  }
  return ids
}

const postSchema = z.object({
  title: z.string().min(1),
  // Allow CJK + letters/digits/hyphens (the form permits Chinese slugs).
  slug: z.string().min(1).regex(/^[\p{L}\p{N}-]+$/u).optional(),
  content_html: z.string().optional(),
  excerpt: z.string().optional(),
  cover_image: z.string().url().optional().nullable(),
  status: z.enum(["draft", "published", "scheduled"]).optional(),
  category_id: z.string().uuid().optional().nullable(),
  // Array of tag UUIDs OR a comma-separated string of tag names (form sends the latter).
  tags: z.union([z.array(z.string().uuid()), z.string()]).optional().nullable(),
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
    .select("id, title, slug, status, published_at, created_at, category_id, author_id, post_categories(id, name, slug)", { count: "exact" })
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
  // Attach existing tags as a comma-separated name string so the editor form
  // round-trips them (otherwise a save would clear all tag links).
  const { data: tagLinks } = await supabase
    .from("post_tag_links")
    .select("post_tags(name)")
    .eq("post_id", req.params.id)
  const tags = (tagLinks ?? [])
    .map((l) => (l as { post_tags?: { name?: string } }).post_tags?.name)
    .filter(Boolean)
    .join(",")
  res.json({ data: { ...data, tags } })
})

postsAdminRouter.post("/", requireAuth, requireEditor, async (req, res) => {
  const parsed = postSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { tags, ...postData } = parsed.data
  if (!postData.slug) {
    postData.slug = slugify(postData.title)
  }

  // Auto-set published_at when creating a published post
  const now = new Date().toISOString()
  const insertData: Record<string, unknown> = {
    ...postData,
    author_id: res.locals.userId,
    ...(postData.status === "published" ? { published_at: now } : {}),
  }

  const { data, error } = await supabase
    .from("posts")
    .insert(insertData)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }

  // Insert tag links if provided (names resolved to ids, find-or-create)
  const tagIds = await resolveTagIds(tags)
  if (tagIds.length > 0 && data) {
    const tagLinks = tagIds.map(tag_id => ({ post_id: data.id, tag_id }))
    await supabase.from("post_tag_links").insert(tagLinks)
  }

  res.status(201).json({ data })
})

// PUT /admin/posts/:id — requireAuth + requireEditor
postsAdminRouter.put("/:id", requireAuth, requireEditor, async (req, res) => {
  const parsed = postUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { tags, ...postData } = parsed.data

  // If transitioning to published, set published_at only if not already set
  const updateData: Record<string, unknown> = { ...postData }
  if (postData.status === "published") {
    const { data: existing } = await supabase
      .from("posts")
      .select("published_at")
      .eq("id", req.params.id)
      .single()
    if (!existing?.published_at) {
      updateData.published_at = new Date().toISOString()
    }
  }

  const { data, error } = await supabase
    .from("posts")
    .update(updateData)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Post not found" }); return }

  // Update tag links if the field was sent (names resolved to ids).
  if (tags !== undefined) {
    const tagIds = await resolveTagIds(tags)
    await supabase.from("post_tag_links").delete().eq("post_id", req.params.id)
    if (tagIds.length > 0) {
      const tagLinks = tagIds.map(tag_id => ({ post_id: data.id, tag_id }))
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
