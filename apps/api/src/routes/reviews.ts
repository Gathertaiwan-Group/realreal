import { Router, type Request } from "express"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { z } from "zod"

export const reviewsPublicRouter = Router({ mergeParams: true })

type ReviewParams = { productId: string }
export const reviewsAdminRouter = Router()

const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  content: z.string().min(10),
})

// GET /products/:productId/reviews — public, approved only
reviewsPublicRouter.get("/", async (req: Request<ReviewParams>, res) => {
  const productId = req.params.productId

  const { data, error } = await supabase
    .from("product_reviews")
    .select("id, rating, content, author_name, created_at")
    .eq("product_id", productId)
    .eq("is_approved", true)
    .order("created_at", { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }

  const reviews = data ?? []
  const totalCount = reviews.length
  const averageRating = totalCount > 0
    ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalCount) * 10) / 10
    : 0

  res.json({ data: reviews, averageRating, totalCount })
})

// POST /products/:productId/reviews — authenticated users
reviewsPublicRouter.post("/", requireAuth, async (req: Request<ReviewParams>, res) => {
  const productId = req.params.productId
  const parsed = reviewSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const userId = res.locals.userId as string
  const userEmail = res.locals.userEmail as string

  // Get display_name from user_profiles
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .single()

  const authorName = profile?.display_name || userEmail.split("@")[0]

  const { data, error } = await supabase
    .from("product_reviews")
    .insert({
      product_id: productId,
      rating: parsed.data.rating,
      content: parsed.data.content,
      author_name: authorName,
      author_email: userEmail,
      // Require moderation — previously auto-approved, letting any logged-in
      // user publish arbitrary content straight onto the product page.
      is_approved: false,
    })
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  // 201 + a flag the client can use to tell the user it's pending review.
  res.status(201).json({ data, pending_review: true })
})

// GET /admin/reviews — all reviews, paginated, with product name
reviewsAdminRouter.get("/", requireAuth, requireAdmin, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const from = (page - 1) * limit
  const to = from + limit - 1

  const { data, error, count } = await supabase
    .from("product_reviews")
    .select("id, product_id, rating, content, author_name, author_email, is_approved, created_at, products(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) { res.status(500).json({ error: error.message }); return }

  res.json({
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0, pages: Math.ceil((count ?? 0) / limit) },
  })
})

// DELETE /admin/reviews/:id
reviewsAdminRouter.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("product_reviews")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// PATCH /admin/reviews/:id — toggle is_approved
reviewsAdminRouter.patch("/:id", requireAuth, requireAdmin, async (req, res) => {
  // First get current state
  const { data: existing, error: fetchErr } = await supabase
    .from("product_reviews")
    .select("is_approved")
    .eq("id", req.params.id)
    .single()

  if (fetchErr || !existing) { res.status(404).json({ error: "Review not found" }); return }

  const { data, error } = await supabase
    .from("product_reviews")
    .update({ is_approved: !existing.is_approved })
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data })
})
