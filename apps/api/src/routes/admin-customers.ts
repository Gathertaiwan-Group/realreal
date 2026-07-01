import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"
import { adjustPoints } from "../lib/points"

/**
 * Admin customer detail endpoints.
 *
 * Spec: docs/superpowers/specs/2026-05-30-points-tiers-customer-detail-design.md
 * (Section 4).
 *
 * Backs the /admin/customers/[id] single-page UI: one fat GET that
 * assembles profile + tier + auth + balance + expiring + recent orders +
 * ledger + next_tier in a single response, plus four mutation endpoints
 * for the action card (manual point adjust, tier change, send reset email,
 * disable/enable account).
 */
export const adminCustomersRouter = Router()

adminCustomersRouter.use(requireAuth, requireAdmin)

// ---------------------------------------------------------------------------
// GET /admin/customers — list page payload (profiles + tier + email + points)
//
// Replaces the page's previous direct supabase.from("user_profiles") call.
// FE can't read auth.users from the browser (anon role), so we resolve emails
// here via the service role with a single listUsers + map lookup.
// ---------------------------------------------------------------------------

adminCustomersRouter.get("/", async (_req, res) => {
  // 客戶管理列表 = 所有「會員」（role = customer）。
  //
  // 6/30 一次性同步後，DB 內 role='customer' 的人都是真實會員：
  //   - 60 個來自 WP VIP CSV
  //   - 未來新平台註冊的人會自動建 user_profiles + 設 role='customer'
  //     → 也會自動出現在這個列表
  //
  // 排除 admin/editor/viewer 員工（不該被列在客戶名單）。早期實作用
  // wp_imported_at 當「VIP 名單」filter，但 27 個 guest-conversion 跟
  // 8 個測試帳號已經清掉，現在不需要那層 filter。
  const { data: profiles, error: profErr } = await supabase
    .from("user_profiles")
    .select(
      "user_id, display_name, phone, total_spend, charity_savings, created_at, membership_tiers(name)",
    )
    .eq("role", "customer")
    .order("created_at", { ascending: false })
    .limit(500)

  if (profErr) {
    res.status(500).json({ error: profErr.message })
    return
  }
  const rows = (profiles ?? []) as unknown as Array<{
    user_id: string
    display_name: string | null
    phone: string | null
    total_spend: number | string | null
    charity_savings: number | string | null
    created_at: string
    membership_tiers: { name: string } | Array<{ name: string }> | null
  }>

  // Email lookup — one listUsers call covers up to 1000 accounts (plenty).
  // If we ever exceed this we'll need pagination.
  const emailById = new Map<string, string>()
  try {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
    for (const u of data?.users ?? []) {
      if (u.email) emailById.set(u.id, u.email)
    }
  } catch (err) {
    console.warn("[admin/customers] listUsers failed (emails will be missing):", err)
  }

  // Points balances — single bulk read against the materialized-ish view.
  const userIds = rows.map((r) => r.user_id)
  const balanceById = new Map<string, number>()
  if (userIds.length > 0) {
    const { data: bals } = await supabase
      .from("v_user_points_balance")
      .select("user_id, balance")
      .in("user_id", userIds)
    for (const b of (bals ?? []) as Array<{ user_id: string; balance: number | string }>) {
      balanceById.set(b.user_id, Number(b.balance ?? 0))
    }
  }

  const out = rows.map((r) => {
    const tier = Array.isArray(r.membership_tiers)
      ? (r.membership_tiers[0] ?? null)
      : r.membership_tiers
    return {
      user_id: r.user_id,
      display_name: r.display_name,
      phone: r.phone,
      email: emailById.get(r.user_id) ?? null,
      total_spend: Number(r.total_spend ?? 0),
      charity_savings: Number(r.charity_savings ?? 0),
      created_at: r.created_at,
      tier_name: tier?.name ?? null,
      points_balance: balanceById.get(r.user_id) ?? 0,
    }
  })
  res.json({ data: out })
})

// ---------------------------------------------------------------------------
// GET /admin/customers/lookup?email=X — single-row email→id lookup
// Used by the campaigns test bench (admin impersonates a customer scenario).
// ---------------------------------------------------------------------------

adminCustomersRouter.get("/lookup", async (req, res) => {
  const email = String(req.query.email ?? "").trim().toLowerCase()
  if (!email) {
    res.status(400).json({ error: "email query required" })
    return
  }
  // auth.users is read via service role; match case-insensitively
  const { data: { users }, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  const u = (users ?? []).find(x => (x.email ?? "").toLowerCase() === email)
  if (!u) {
    res.status(404).json({ error: "not found" })
    return
  }
  res.json({ data: { id: u.id, email: u.email } })
})

// ---------------------------------------------------------------------------
// GET /admin/customers/:id — full detail page payload
// ---------------------------------------------------------------------------

adminCustomersRouter.get("/:id", async (req, res) => {
  const userId = req.params.id

  // 1. profile + tier (single join)
  const { data: profileRaw, error: profileErr } = await supabase
    .from("user_profiles")
    .select(
      "user_id, display_name, phone, birthday, role, created_at, total_spend, membership_tier_id, " +
        "tier_started_at, tier_expires_at, tier_period_spend, " +
        "membership_tiers(id, name, min_spend, rebate_rate, benefits, discount_rate, sort_order, " +
        "requalify_amount, requalify_window_months, validity_months)",
    )
    .eq("user_id", userId)
    .single()

  if (profileErr || !profileRaw) {
    res.status(404).json({ error: "Customer not found" })
    return
  }

  type TierRow = {
    id: string
    name: string
    min_spend: number | string
    rebate_rate: number | string
    benefits: Record<string, unknown> | null
    discount_rate: number | string
    sort_order: number
    requalify_amount: number | string | null
    requalify_window_months: number | null
    validity_months: number | null
  }

  type ProfileRow = {
    user_id: string
    display_name: string | null
    phone: string | null
    birthday: string | null
    role: string | null
    created_at: string
    total_spend: number | string | null
    membership_tier_id: string | null
    tier_started_at: string | null
    tier_expires_at: string | null
    tier_period_spend: number | string | null
    membership_tiers: TierRow | Array<TierRow> | null
  }

  const profile = profileRaw as unknown as ProfileRow
  const tier = Array.isArray(profile.membership_tiers)
    ? (profile.membership_tiers[0] ?? null)
    : profile.membership_tiers

  // 2. auth user (email + last_sign_in_at) via admin API
  let email: string | null = null
  let lastSignInAt: string | null = null
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    email = data?.user?.email ?? null
    lastSignInAt = data?.user?.last_sign_in_at ?? null
  } catch {
    /* keep nulls */
  }

  // 3. points balance + expiring soon (next 30 days)
  const { data: ledgerAll } = await supabase
    .from("points_ledger")
    .select("delta")
    .eq("user_id", userId)
  const balance = (ledgerAll ?? []).reduce(
    (acc: number, r: any) => acc + Number(r.delta ?? 0),
    0,
  )

  const now = new Date()
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
  const { data: expiringRows } = await supabase
    .from("points_ledger")
    .select("id, delta")
    .eq("user_id", userId)
    .eq("source", "earn")
    .not("expires_at", "is", null)
    .gte("expires_at", now.toISOString())
    .lt("expires_at", in30.toISOString())

  // Subtract any earn rows that have already been expired (a matching
  // expire row references the earn row's id in source_ref_id).
  const earnIds = (expiringRows ?? []).map((r: any) => r.id as string)
  const alreadyExpired = new Set<string>()
  if (earnIds.length > 0) {
    const { data: exp } = await supabase
      .from("points_ledger")
      .select("source_ref_id")
      .eq("source", "expire")
      .in("source_ref_id", earnIds)
    for (const row of exp ?? []) {
      const ref = (row as { source_ref_id: string | null }).source_ref_id
      if (ref) alreadyExpired.add(ref)
    }
  }
  const expiringSoon = (expiringRows ?? [])
    .filter((r: any) => !alreadyExpired.has(r.id as string))
    .reduce((acc: number, r: any) => acc + Number(r.delta ?? 0), 0)

  // 4. recent 10 orders
  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, order_number, total, status, payment_status, points_used, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10)

  // 5. latest 50 ledger rows
  const { data: ledger } = await supabase
    .from("points_ledger")
    .select(
      "id, delta, source, source_ref_id, note, expires_at, actor_id, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50)

  // 6. next_tier = first tier whose min_spend > current total_spend
  const totalSpend = Number(profile.total_spend ?? 0)
  const { data: nextTierRows } = await supabase
    .from("membership_tiers")
    .select("id, name, min_spend, rebate_rate")
    .gt("min_spend", totalSpend)
    .order("min_spend", { ascending: true })
    .limit(1)
  const nextTier =
    nextTierRows && nextTierRows.length > 0 ? nextTierRows[0] : null

  res.json({
    data: {
      profile: {
        user_id: profile.user_id,
        display_name: profile.display_name,
        phone: profile.phone,
        birthday: profile.birthday,
        role: profile.role,
        created_at: profile.created_at,
        total_spend: totalSpend,
        membership_tier_id: profile.membership_tier_id,
        tier_started_at: profile.tier_started_at,
        tier_expires_at: profile.tier_expires_at,
        tier_period_spend: Number(profile.tier_period_spend ?? 0),
        email,
        last_sign_in_at: lastSignInAt,
      },
      tier,
      points: {
        balance,
        expiring_soon: expiringSoon,
      },
      orders: orders ?? [],
      ledger: ledger ?? [],
      next_tier: nextTier,
    },
  })
})

// ---------------------------------------------------------------------------
// PATCH /admin/customers/:id/profile — edit display_name / phone / birthday
// ---------------------------------------------------------------------------
// Only these three fields are exposed. tier / total_spend / charity_savings
// 都由別的 endpoint 或系統 trigger 維護，避免手動亂改破壞會員等級邏輯。

const editProfileSchema = z.object({
  display_name: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  birthday: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "生日格式須為 YYYY-MM-DD")
    .nullable()
    .optional(),
})

adminCustomersRouter.patch("/:id/profile", async (req, res) => {
  const parsed = editProfileSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }
  // Empty string → NULL 讓 admin 可以清空欄位
  const updates: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue
    updates[k] = v === "" ? null : (v as string | null)
  }
  if (Object.keys(updates).length === 0) {
    res.json({ ok: true }); return
  }
  const { error } = await supabase
    .from("user_profiles")
    .update(updates)
    .eq("user_id", req.params.id)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// POST /admin/customers/:id/points/adjust — manual point adjustment
// ---------------------------------------------------------------------------

const adjustSchema = z.object({
  delta: z.number().int().refine((v) => v !== 0, "delta must be non-zero"),
  note: z.string().trim().min(1, "note 必填").max(500),
})

adminCustomersRouter.post("/:id/points/adjust", async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }
  const userId = req.params.id
  const actorId = res.locals.userId as string

  try {
    // B5: adjustPoints now throws when the points_ledger insert returns an
    // error (previously it swallowed `.error` and this route reported ok:true
    // on a write that never landed). A throw here → 500, so the admin never
    // sees a phantom "granted" for a failed money write.
    await adjustPoints(userId, parsed.data.delta, parsed.data.note, actorId)
    res.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(500).json({ error: msg })
  }
})

// ---------------------------------------------------------------------------
// PATCH /admin/customers/:id/tier — change membership tier
// ---------------------------------------------------------------------------

const tierSchema = z.object({
  tier_id: z.string().uuid(),
})

adminCustomersRouter.patch("/:id/tier", async (req, res) => {
  const parsed = tierSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }
  const userId = req.params.id

  // Sanity check — tier must exist
  const { data: tier } = await supabase
    .from("membership_tiers")
    .select("id")
    .eq("id", parsed.data.tier_id)
    .maybeSingle()
  if (!tier) {
    res.status(400).json({ error: "Tier not found" })
    return
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({ membership_tier_id: parsed.data.tier_id })
    .eq("user_id", userId)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// POST /admin/customers/:id/send-reset-email — trigger password reset
// ---------------------------------------------------------------------------
//
// Supabase admin API doesn't expose a "send-reset-email" call directly, so
// we generate a recovery link (which the admin client returns) — Supabase
// also sends the email automatically when SMTP is configured. We don't
// surface the link to the admin (security), only the success/failure.

adminCustomersRouter.post("/:id/send-reset-email", async (req, res) => {
  const userId = req.params.id

  // Need the user's email to call generateLink
  const { data: userData } = await supabase.auth.admin.getUserById(userId)
  const email = userData?.user?.email
  if (!email) {
    res.status(404).json({ error: "Customer has no email on file" })
    return
  }

  try {
    const { error } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"}/auth/reset-password`,
      },
    })
    if (error) {
      res.status(502).json({ error: error.message })
      return
    }
    res.json({ ok: true, message: `已寄出密碼重設信至 ${email}` })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(502).json({ error: msg })
  }
})

// ---------------------------------------------------------------------------
// PATCH /admin/customers/:id/disabled — soft delete (toggle disabled role)
// ---------------------------------------------------------------------------
//
// Mirrors the team CRUD pattern (admin-team.ts uses role='viewer' for
// removal). For customers we flip role between 'customer' and 'disabled'
// — the role check constraint in 0005_cms_tables.sql allows 'customer',
// 'admin', 'editor', 'viewer'. 'disabled' is added by the customer-detail
// spec; if the constraint hasn't been migrated, the UPDATE will error and
// we surface it to the admin.

const disabledSchema = z.object({
  disabled: z.boolean(),
})

adminCustomersRouter.patch("/:id/disabled", async (req, res) => {
  const parsed = disabledSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }
  const userId = req.params.id
  const callerId = res.locals.userId as string

  // Self-disable guard.
  if (userId === callerId) {
    res.status(400).json({ error: "Cannot disable your own account" })
    return
  }

  const newRole = parsed.data.disabled ? "disabled" : "customer"

  const { error } = await supabase
    .from("user_profiles")
    .update({ role: newRole })
    .eq("user_id", userId)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true, role: newRole })
})
