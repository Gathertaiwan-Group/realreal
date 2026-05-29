import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"

export const adminTeamRouter = Router()

adminTeamRouter.use(requireAuth, requireAdmin)

type Role = "admin" | "editor" | "viewer"
const ROLES: readonly Role[] = ["admin", "editor", "viewer"] as const

interface TeamMember {
  user_id: string
  email: string | null
  display_name: string | null
  role: Role
  created_at: string
}

// GET /admin/team — list members with role !== 'viewer'
adminTeamRouter.get("/", async (_req, res) => {
  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("user_id, display_name, role, created_at")
    .in("role", ["admin", "editor"])
    .order("created_at", { ascending: true })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  // Resolve emails via auth admin API (user_profiles doesn't store email).
  const members: TeamMember[] = await Promise.all(
    (profiles ?? []).map(async (p) => {
      let email: string | null = null
      try {
        const { data } = await supabase.auth.admin.getUserById(p.user_id as string)
        email = data?.user?.email ?? null
      } catch { /* ignore */ }
      return {
        user_id: p.user_id as string,
        email,
        display_name: (p.display_name as string | null) ?? null,
        role: (p.role as Role) ?? "viewer",
        created_at: p.created_at as string,
      }
    }),
  )

  res.json({ data: members })
})

// POST /admin/team — promote an existing auth user by email
const promoteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "editor"]),
})

adminTeamRouter.post("/", async (req, res) => {
  const parsed = promoteSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }

  const { email, role } = parsed.data

  // Find the auth user by email. Supabase admin API doesn't have a direct
  // "get by email" — paginate through users until we find a match. Fine
  // for the small team this UI manages.
  let targetUserId: string | null = null
  let page = 1
  while (page < 20 && !targetUserId) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 50 })
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) targetUserId = hit.id
    if (data.users.length < 50) break
    page++
  }

  if (!targetUserId) {
    res.status(404).json({ error: `No registered user with email ${email}. Ask them to sign up first.` })
    return
  }

  // Upsert role onto the profile.
  const { error } = await supabase
    .from("user_profiles")
    .upsert(
      { user_id: targetUserId, role },
      { onConflict: "user_id" },
    )
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ ok: true, user_id: targetUserId })
})

// PATCH /admin/team/:userId — change role
const updateRoleSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]),
})

adminTeamRouter.patch("/:userId", async (req, res) => {
  const parsed = updateRoleSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }

  const targetUserId = req.params.userId
  const callerUserId = res.locals.userId as string
  const newRole = parsed.data.role

  // Self-edit guard.
  if (targetUserId === callerUserId) {
    res.status(400).json({ error: "Cannot change your own role" })
    return
  }

  // Last-admin guard: refuse to demote the last admin.
  if (newRole !== "admin") {
    const { data: target } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", targetUserId)
      .maybeSingle()

    if (target?.role === "admin") {
      const { count, error: countErr } = await supabase
        .from("user_profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("role", "admin")
      if (countErr) {
        res.status(500).json({ error: countErr.message })
        return
      }
      if ((count ?? 0) <= 1) {
        res.status(400).json({
          error: "Cannot demote the last admin — promote another admin first.",
        })
        return
      }
    }
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({ role: newRole })
    .eq("user_id", targetUserId)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  res.json({ ok: true })
})

// DELETE /admin/team/:userId — soft-delete (demote to viewer).
// Same guards as PATCH (no self-delete, no last-admin demote).
adminTeamRouter.delete("/:userId", async (req, res) => {
  const targetUserId = req.params.userId
  const callerUserId = res.locals.userId as string

  if (targetUserId === callerUserId) {
    res.status(400).json({ error: "Cannot remove yourself" })
    return
  }

  const { data: target } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", targetUserId)
    .maybeSingle()

  if (target?.role === "admin") {
    const { count, error: countErr } = await supabase
      .from("user_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin")
    if (countErr) {
      res.status(500).json({ error: countErr.message })
      return
    }
    if ((count ?? 0) <= 1) {
      res.status(400).json({
        error: "Cannot remove the last admin — promote another admin first.",
      })
      return
    }
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({ role: "viewer" })
    .eq("user_id", targetUserId)
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

void ROLES // helper export hint to quiet strict-mode unused warnings
