import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { requireEditor } from "../middleware/editor"

export const campaignsRouter = Router()

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const campaignCreateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional().nullable(),
  tier_id: z.string().uuid().optional().nullable(),
  type: z.enum(["discount", "freebie", "points_multiplier", "free_shipping", "bundle", "buy_x_get_y", "second_half_price", "spend_threshold", "tier_upgrade_bonus", "combo_discount", "birthday_bonus"]),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  coupon_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime().optional().nullable(),
})

const campaignUpdateSchema = campaignCreateSchema.partial()

// ---------------------------------------------------------------------------
// GET /admin/campaigns — list all campaigns (admin/editor)
// ---------------------------------------------------------------------------

campaignsRouter.get("/admin/campaigns", requireAuth, requireEditor, async (_req, res) => {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, membership_tiers(name), coupons(code)")
    .order("created_at", { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})

// ---------------------------------------------------------------------------
// GET /admin/campaigns/:id — single campaign detail (admin/editor)
// ---------------------------------------------------------------------------

campaignsRouter.get("/admin/campaigns/:id", requireAuth, requireEditor, async (req, res) => {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, membership_tiers(name), coupons(code)")
    .eq("id", req.params.id)
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Campaign not found" }); return }
  res.json({ data })
})

// ---------------------------------------------------------------------------
// POST /admin/campaigns — create campaign (admin only)
// ---------------------------------------------------------------------------

campaignsRouter.post("/admin/campaigns", requireAuth, requireAdmin, async (req, res) => {
  const parsed = campaignCreateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("campaigns")
    .insert(parsed.data)
    .select("*, membership_tiers(name), coupons(code)")
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(201).json({ data })
})

// ---------------------------------------------------------------------------
// PUT /admin/campaigns/:id — update campaign (admin only)
// ---------------------------------------------------------------------------

campaignsRouter.put("/admin/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = campaignUpdateSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return }

  const { data, error } = await supabase
    .from("campaigns")
    .update(parsed.data)
    .eq("id", req.params.id)
    .select("*, membership_tiers(name), coupons(code)")
    .single()

  if (error) { res.status(500).json({ error: error.message }); return }
  if (!data) { res.status(404).json({ error: "Campaign not found" }); return }
  res.json({ data })
})

// ---------------------------------------------------------------------------
// DELETE /admin/campaigns/:id — delete campaign (admin only)
// ---------------------------------------------------------------------------

campaignsRouter.delete("/admin/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", req.params.id)

  if (error) { res.status(500).json({ error: error.message }); return }
  res.status(204).send()
})

// ---------------------------------------------------------------------------
// GET /campaigns/active — public, list currently active campaigns
// ---------------------------------------------------------------------------

campaignsRouter.get("/campaigns/active", async (_req, res) => {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from("campaigns")
    .select("*, membership_tiers(name)")
    .eq("is_active", true)
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order("starts_at", { ascending: false })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [] })
})
