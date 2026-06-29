import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { verifyWordPressHash } from "../lib/phpass"

export const authLegacyRouter = Router()

/**
 * POST /auth/legacy/verify-and-migrate
 *
 * One-shot WordPress password migration. Called by apps/web's loginAction
 * when Supabase Auth rejects a (email, password) pair with "Invalid login
 * credentials" — at that point we don't yet know whether the user came from
 * the WP import (wp_legacy_password_hash IS NOT NULL) or just typed the
 * wrong password. This endpoint short-circuits that:
 *
 *   1. Look up user_profiles by email (via auth.admin.listUsers, since
 *      auth.users isn't queryable from PostgREST without a custom view).
 *   2. If no wp_legacy_password_hash → return migrated=false, hand back
 *      to the caller so it surfaces the normal "Invalid login credentials".
 *   3. Otherwise verify password against the PHPass hash from WP.
 *      - On success: admin.updateUserById to set the typed password (now
 *        bcrypt-hashed by Supabase), clear wp_legacy_password_hash, return
 *        migrated=true. The caller then retries signInWithPassword and it
 *        succeeds normally.
 *      - On mismatch: return migrated=false (real wrong password).
 *
 * Idempotent: once wp_legacy_password_hash is null, subsequent calls just
 * return migrated=false and the caller falls through.
 *
 * Privacy: never echoes the password or hash back. Only returns boolean.
 */
authLegacyRouter.post("/verify-and-migrate", async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ migrated: false, error: "invalid_payload" })
    return
  }
  const { email, password } = parsed.data

  let userId: string | null = null
  try {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    userId = match?.id ?? null
  } catch (err) {
    console.error("[auth-legacy] listUsers failed:", err)
    res.status(500).json({ migrated: false, error: "lookup_failed" })
    return
  }
  if (!userId) {
    res.json({ migrated: false })
    return
  }

  const { data: profile, error: profileErr } = await supabase
    .from("user_profiles")
    .select("wp_legacy_password_hash")
    .eq("user_id", userId)
    .maybeSingle()
  if (profileErr) {
    console.error("[auth-legacy] user_profiles lookup failed:", profileErr)
    res.status(500).json({ migrated: false, error: "profile_lookup_failed" })
    return
  }
  const wpHash = (profile as { wp_legacy_password_hash?: string | null } | null)
    ?.wp_legacy_password_hash
  if (!wpHash) {
    res.json({ migrated: false })
    return
  }

  let valid = false
  try {
    valid = await verifyWordPressHash(password, wpHash)
  } catch (err) {
    console.error("[auth-legacy] hash verify threw:", err)
    res.status(500).json({ migrated: false, error: "verify_failed" })
    return
  }
  if (!valid) {
    res.json({ migrated: false })
    return
  }

  // Verified. Migrate to bcrypt + clear the legacy hash. Both writes are
  // wrapped in try blocks so a flake in either leaves the system in a
  // recoverable state (user can retry; password is still in WP hash).
  try {
    const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
      password,
    })
    if (updErr) {
      console.error("[auth-legacy] admin.updateUserById failed:", updErr)
      res.status(500).json({ migrated: false, error: "rehash_failed" })
      return
    }
  } catch (err) {
    console.error("[auth-legacy] admin.updateUserById threw:", err)
    res.status(500).json({ migrated: false, error: "rehash_failed" })
    return
  }

  try {
    await supabase
      .from("user_profiles")
      .update({ wp_legacy_password_hash: null })
      .eq("user_id", userId)
  } catch (err) {
    console.warn("[auth-legacy] clearing wp_legacy_password_hash failed (non-fatal):", err)
  }

  res.json({ migrated: true })
})
