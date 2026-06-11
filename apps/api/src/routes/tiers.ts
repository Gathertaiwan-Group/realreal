import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"
import { getMemberDiscountRate } from "../lib/tier"

export const tiersRouter = Router()

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const tierCreateSchema = z.object({
  name: z.string().min(1).max(100),
  min_spend: z.number().nonnegative(),
  discount_rate: z.number().nonnegative(),
  benefits: z.record(z.string(), z.unknown()).optional().default({}),
  sort_order: z.number().int().nonnegative().optional().default(0),
  // Fields the admin tier editor (apps/web/.../admin/marketing/tiers/page.tsx)
  // sends. Previously omitted here, so Zod silently stripped them and they were
  // never persisted. Columns exist per migrations 0017 (rebate_rate) and 0021
  // (tagline/perks/validity_months/requalify_*). All optional so partial PUTs
  // and minimal POSTs still validate.
  rebate_rate: z.number().nonnegative().optional(),
  tagline: z.string().optional(),
  // perks is a JSON array of strings (one perk per line in the UI editor).
  perks: z.array(z.string()).optional(),
  validity_months: z.number().int().nonnegative().optional(),
  requalify_amount: z.number().nonnegative().optional(),
  requalify_window_months: z.number().int().nonnegative().optional(),
})

const tierUpdateSchema = tierCreateSchema.partial()

// ---------------------------------------------------------------------------
// GET /membership-tiers — public, list all tiers ordered by sort_order
// ---------------------------------------------------------------------------

tiersRouter.get("/membership-tiers", async (_req, res) => {
  const { data, error } = await supabase
    .from("membership_tiers")
    .select("*")
    .order("sort_order", { ascending: true })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})

// ---------------------------------------------------------------------------
// POST /admin/membership-tiers — create tier (admin only)
// ---------------------------------------------------------------------------

tiersRouter.post("/admin/membership-tiers", requireAuth, requireAdmin, async (req, res) => {
  const parsed = tierCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("membership_tiers")
    .insert(parsed.data)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// ---------------------------------------------------------------------------
// PUT /admin/membership-tiers/:id — update tier (admin only)
// ---------------------------------------------------------------------------

tiersRouter.put("/admin/membership-tiers/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = tierUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("membership_tiers")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Tier not found" }); return }
  res.json({ data })
})

// ---------------------------------------------------------------------------
// DELETE /admin/membership-tiers/:id — delete tier (admin only)
// Prevent deletion if users exist on this tier.
// ---------------------------------------------------------------------------

tiersRouter.delete("/admin/membership-tiers/:id", requireAuth, requireAdmin, async (req, res) => {
  // Check if any users are on this tier
  const { count, error: countError } = await supabase
    .from("user_profiles")
    .select("*", { count: "exact", head: true })
    .eq("membership_tier_id", req.params.id)

  if (countError) { res.status(500).json({ error: countError.message }); return }
  if (count && count > 0) {
    res.status(409).json({ error: "Cannot delete tier: users are currently assigned to this tier" }); return
  }

  const { error } = await supabase
    .from("membership_tiers")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// ---------------------------------------------------------------------------
// GET /tiers/:id/linked-campaigns — list active campaigns linked to a tier
// (editor only). Used by the tier-detail admin UI to surface where a tier's
// rebate/discount logic is being referenced from campaigns.
// ---------------------------------------------------------------------------

tiersRouter.get(
  "/tiers/:id/linked-campaigns",
  requireAuth,
  requireEditor,
  async (req, res) => {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("tier_id", req.params.id)
      .eq("is_active", true)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ data: data ?? [] })
  },
)

// ---------------------------------------------------------------------------
// GET /my-member-discount — return current user's discount rate (auth required)
// ---------------------------------------------------------------------------

tiersRouter.get("/my-member-discount", requireAuth, async (_req, res) => {
  const userId = res.locals.userId as string
  const discountRate = await getMemberDiscountRate(userId)

  // Also fetch tier name for display
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("membership_tier_id")
    .eq("user_id", userId)
    .single()

  let tierName: string | null = null
  if (profile?.membership_tier_id) {
    const { data: tier } = await supabase
      .from("membership_tiers")
      .select("name")
      .eq("id", profile.membership_tier_id)
      .single()
    tierName = tier?.name ?? null
  }

  res.json({ data: { discountRate, tierName } })
})
