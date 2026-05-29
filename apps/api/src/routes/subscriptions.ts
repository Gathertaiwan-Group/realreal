import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { encryptToken } from "../lib/token-encryption"

export const subscriptionPlansRouter = Router()
export const subscriptionsRouter = Router()

// GET /subscription-plans — list active plans (public)
subscriptionPlansRouter.get("/", async (_req, res) => {
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("id, name, type, interval, price")
    .eq("is_active", true)
    .order("price", { ascending: true })

  if (error) {
    console.error("[subscription-plans] fetch failed:", error)
    res.status(500).json({ error: error.message }); return
  }

  res.json({ data: data ?? [] })
})

const createSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  paymentMethodToken: z.string().min(1),
})

const patchSubscriptionSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]),
})

// POST /subscriptions — create subscription (requireAuth applied at app level)
subscriptionsRouter.post("/", async (req, res) => {
  const userId = res.locals.userId as string

  const parsed = createSubscriptionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() }); return
  }

  const { planId, paymentMethodToken } = parsed.data

  // Verify plan exists and is active
  const { data: plan, error: planError } = await supabase
    .from("subscription_plans")
    .select("id, interval")
    .eq("id", planId)
    .eq("is_active", true)
    .single()

  if (planError || !plan) {
    res.status(404).json({ error: "Plan not found or inactive" }); return
  }

  // Encrypt the payment method token before saving
  let encryptedToken: string
  try {
    encryptedToken = await encryptToken(paymentMethodToken)
  } catch (err: any) {
    console.error("[subscriptions] token encryption failed:", err)
    res.status(500).json({ error: "Failed to secure payment token" }); return
  }

  // Compute next_billing_date
  const nextBillingDate = new Date()
  nextBillingDate.setDate(nextBillingDate.getDate() + (plan.interval === "monthly" ? 30 : 60))
  const nextBillingDateStr = nextBillingDate.toISOString().split("T")[0]

  const { data: sub, error: insertError } = await supabase
    .from("subscriptions")
    .insert({
      user_id: userId,
      plan_id: planId,
      status: "active",
      payment_method_token: encryptedToken,
      token_key_version: 1,
      next_billing_date: nextBillingDateStr,
      retry_count: 0,
    })
    .select("id, plan_id, status, next_billing_date, created_at")
    .single()

  if (insertError || !sub) {
    console.error("[subscriptions] insert failed:", insertError)
    res.status(500).json({ error: "Failed to create subscription" }); return
  }

  res.status(201).json({ data: sub })
})

// GET /subscriptions — list user's subscriptions (requireAuth applied at app level)
subscriptionsRouter.get("/", async (req, res) => {
  const userId = res.locals.userId as string

  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, plan_id, status, next_billing_date, retry_count, created_at, subscription_plans(name, type, interval, price)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message }); return
  }

  res.json({ data: data ?? [] })
})

// PATCH /subscriptions/:id — pause/resume/cancel (requireAuth applied at app level)
subscriptionsRouter.patch("/:id", async (req, res) => {
  const userId = res.locals.userId as string
  const subscriptionId = req.params.id

  const parsed = patchSubscriptionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() }); return
  }

  const { action } = parsed.data

  // Ownership check
  const { data: sub, error: fetchError } = await supabase
    .from("subscriptions")
    .select("id, user_id, status")
    .eq("id", subscriptionId)
    .single()

  if (fetchError || !sub) {
    res.status(404).json({ error: "Subscription not found" }); return
  }

  if (sub.user_id !== userId) {
    res.status(403).json({ error: "Forbidden" }); return
  }

  const statusMap: Record<string, string> = {
    pause: "paused",
    resume: "active",
    cancel: "cancelled",
  }

  const newStatus = statusMap[action]

  const { data: updated, error: updateError } = await supabase
    .from("subscriptions")
    .update({ status: newStatus })
    .eq("id", subscriptionId)
    .select("id, status")
    .single()

  if (updateError || !updated) {
    console.error("[subscriptions] update failed:", updateError)
    res.status(500).json({ error: "Failed to update subscription" }); return
  }

  res.json({ data: updated })
})
