import { Router } from "express"
import { createHash } from "crypto"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { optionalAuth } from "../middleware/auth"

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
        "coupon_id, commission_rate, is_active, " +
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
