import { Router } from "express"
import { createHash } from "crypto"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { optionalAuth } from "../middleware/auth"
import { enrichProducts } from "../lib/enrich-products"

/**
 * Public KOL / affiliate routes.
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
 * (Section 2).
 *
 *  - GET  /kols/:slug         — fetch active KOL by slug (landing page data)
 *  - POST /kols/track-click   — analytics: record a KOL link click
 *                               (fire-and-forget; optional auth)
 */
export const kolsRouter = Router()

// Hardcoded server-side salt for v1 IP hashing (privacy).
// If we ever want to rotate, move to env (KOL_IP_HASH_SALT) without breaking
// historical rows — old hashes simply stop matching new ones for analytics.
const IP_HASH_SALT = "realreal-kol-2026"

function hashIp(ip: string | undefined | null): string | null {
  if (!ip) return null
  return createHash("sha256").update(`${ip}${IP_HASH_SALT}`).digest("hex")
}

// ---------------------------------------------------------------------------
// GET /kols/:slug — public KOL landing data
// ---------------------------------------------------------------------------

kolsRouter.get("/:slug", async (req, res) => {
  const slug = String(req.params.slug ?? "").trim().toLowerCase()
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(404).json({ error: "KOL not found" })
    return
  }

  const { data, error } = await supabase
    .from("kols")
    .select(
      "id, slug, name, avatar_url, bio, instagram_handle, youtube_handle, tiktok_handle, " +
        "coupon_id, commission_rate, is_active, recommended_product_ids, " +
        "coupons(id, code, type, value)",
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(404).json({ error: "KOL not found" })
    return
  }
  // Supabase types narrow imperfectly with join embeds — narrow manually.
  const kol = data as unknown as {
    id: string
    slug: string
    name: string
    avatar_url: string | null
    bio: string | null
    instagram_handle: string | null
    youtube_handle: string | null
    tiktok_handle: string | null
    recommended_product_ids: string[] | null
    coupons?: unknown
  }

  type CouponRow = {
    id: string
    code: string
    type: "percentage" | "fixed"
    value: number | string
  }

  const couponRaw = kol.coupons as CouponRow | CouponRow[] | null | undefined
  const coupon = Array.isArray(couponRaw) ? (couponRaw[0] ?? null) : couponRaw ?? null

  // Fetch this KOL's recommended products. Reuses the same enrichProducts()
  // helper GET /products uses, so these objects carry min_price / max_price /
  // min_sale_price / total_stock exactly like every other product card on
  // the site — those aren't real columns on `products`, they're computed
  // from product_variants. Products deactivated/deleted after being picked
  // are silently dropped (admin picker already filters on write; this
  // covers drift since then). Order is re-applied after the fetch because
  // Supabase's `.in()` does not preserve the input array's ordering.
  const productIds = kol.recommended_product_ids ?? []
  let products: Array<Record<string, unknown> & { id: string }> = []
  if (productIds.length > 0) {
    const { data: productRows, error: productsError } = await supabase
      .from("products")
      .select(
        "id, name, slug, description, excerpt, category_id, images, is_active, is_featured, " +
          "is_addon, display_priority, created_at, min_tier_id, " +
          "membership_tiers!min_tier_id(id, name, min_spend)",
      )
      .in("id", productIds)
      .eq("is_active", true)
      .is("deleted_at", null)

    if (productsError) {
      res.status(500).json({ error: productsError.message })
      return
    }

    const enriched = await enrichProducts(productRows ?? [])
    const byId = new Map(
      (enriched as Array<{ id: string }>).map((p) => [p.id, p]),
    )
    products = productIds
      .map((id) => byId.get(id))
      .filter((p): p is Record<string, unknown> & { id: string } => Boolean(p))
  }

  res.json({
    data: {
      id: kol.id,
      slug: kol.slug,
      name: kol.name,
      avatar_url: kol.avatar_url,
      bio: kol.bio,
      socials: {
        instagram: kol.instagram_handle,
        youtube: kol.youtube_handle,
        tiktok: kol.tiktok_handle,
      },
      coupon: coupon
        ? {
            id: coupon.id,
            code: coupon.code,
            type: coupon.type,
            value: Number(coupon.value),
          }
        : null,
      products,
    },
  })
})

// ---------------------------------------------------------------------------
// POST /kols/track-click — analytics (fire-and-forget)
// ---------------------------------------------------------------------------

const trackClickSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/),
  path: z.string().min(1).max(2048),
})

kolsRouter.post("/track-click", optionalAuth, async (req, res) => {
  // Respond immediately — analytics is best-effort and must not block UX.
  res.status(200).json({ ok: true })

  const parsed = trackClickSchema.safeParse(req.body)
  if (!parsed.success) return

  const { slug, path } = parsed.data
  const userId = (res.locals.userId as string | undefined) ?? null
  const ipHash = hashIp(req.ip)
  const userAgent = req.headers["user-agent"]?.toString().slice(0, 1024) ?? null

  try {
    const { data: kol } = await supabase
      .from("kols")
      .select("id")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle()
    if (!kol) return

    await supabase.from("kol_clicks").insert({
      kol_id: kol.id,
      path,
      user_id: userId,
      ip_hash: ipHash,
      user_agent: userAgent,
    })
  } catch (err) {
    // Swallow — analytics failure must never surface to caller.
    console.error("[kols/track-click] insert failed:", err)
  }
})
