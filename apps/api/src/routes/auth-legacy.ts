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

/**
 * POST /auth/legacy/register-from-guest
 *
 * Post-checkout conversion path: a guest just finished an order with
 * `guest_email`, and the confirm page wants to turn that email into a
 * Supabase Auth account in one click — without sending a verification
 * email and without leaving the page.
 *
 * Body: { email, password, displayName?, orderNumber }
 *
 * Proof of ownership: caller must supply `orderNumber`, and the guest_email
 * on that order must match `email`. Without this, anyone could register on
 * any email by guessing the address.
 *
 * On success:
 *   1. Create the Supabase Auth user with email_confirm: true so the
 *      session works immediately without a confirmation hop. (Migration
 *      0022's trigger auto-creates the user_profiles row.)
 *   2. Bulk-claim ALL still-unclaimed guest orders with the same email —
 *      not just the one in `orderNumber`. Past guest checkouts on the
 *      same device/email all get pulled into the new account at once.
 *      first_purchase_applied flags are normalised to keep at most one
 *      row per user (the partial unique index `uniq_first_purchase_per_user`
 *      otherwise trips on UPDATE).
 */
authLegacyRouter.post("/register-from-guest", async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    displayName: z.string().max(100).optional(),
    orderNumber: z.string().min(1),
  }).safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_payload", details: parsed.error.flatten() })
    return
  }
  const { email, password, displayName, orderNumber } = parsed.data
  const normalisedEmail = email.toLowerCase()

  // 1. Verify the order exists, is a guest order, and matches the email.
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, user_id, guest_email")
    .eq("order_number", orderNumber)
    .maybeSingle()
  if (orderErr) {
    console.error("[auth-legacy register-from-guest] order lookup failed:", orderErr)
    res.status(500).json({ error: "lookup_failed" })
    return
  }
  if (!order) {
    res.status(400).json({ error: "order_not_found" })
    return
  }
  const orderRow = order as { id: string; user_id: string | null; guest_email: string | null }
  if (orderRow.user_id) {
    res.status(400).json({ error: "order_already_claimed" })
    return
  }
  if ((orderRow.guest_email ?? "").toLowerCase() !== normalisedEmail) {
    res.status(400).json({ error: "email_mismatch" })
    return
  }

  // 2. Reject if this email is already a Supabase user — they should sign in
  // instead. Frontend surfaces a "請改用登入" link on this code.
  try {
    const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
    if (existing.users.some((u) => (u.email ?? "").toLowerCase() === normalisedEmail)) {
      res.status(422).json({ error: "email_already_registered" })
      return
    }
  } catch (err) {
    console.error("[auth-legacy register-from-guest] listUsers failed:", err)
    res.status(500).json({ error: "lookup_failed" })
    return
  }

  // 3. Create the user (email_confirm: true → session works immediately,
  // no verification email). The 0022 trigger handles user_profiles.
  let newUserId: string
  try {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: normalisedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName?.trim() || normalisedEmail.split("@")[0],
        imported_from: "guest_checkout",
      },
    })
    if (createErr || !created.user) {
      console.error("[auth-legacy register-from-guest] createUser failed:", createErr)
      res.status(500).json({ error: "create_failed", detail: createErr?.message })
      return
    }
    newUserId = created.user.id
  } catch (err) {
    console.error("[auth-legacy register-from-guest] createUser threw:", err)
    res.status(500).json({ error: "create_failed" })
    return
  }

  // 4. Bulk-claim all unclaimed guest orders with this email. We do this in
  // two steps so we can normalise first_purchase_applied: keep the flag on
  // the OLDEST matching order, flip it off on the rest (otherwise the
  // partial unique index uniq_first_purchase_per_user trips when multiple
  // claimed orders all have first_purchase_applied=true).
  let claimedOrderCount = 0
  try {
    const { data: candidateOrders } = await supabase
      .from("orders")
      .select("id, created_at, first_purchase_applied")
      .is("user_id", null)
      .eq("guest_email", normalisedEmail)
      .order("created_at", { ascending: true })

    const rows = (candidateOrders ?? []) as Array<{
      id: string
      created_at: string
      first_purchase_applied: boolean
    }>

    // Among the rows that already had first_purchase_applied=true, keep the
    // earliest one; flip the rest. New user with no prior orders has zero
    // history, so picking the oldest is the right "this WAS your first" anchor.
    const firstPurchaseClaimed = rows.filter((r) => r.first_purchase_applied)
    const idsToDemote = firstPurchaseClaimed.slice(1).map((r) => r.id)
    if (idsToDemote.length > 0) {
      await supabase
        .from("orders")
        .update({ first_purchase_applied: false })
        .in("id", idsToDemote)
    }

    // Now claim all of them.
    const { data: claimed } = await supabase
      .from("orders")
      .update({ user_id: newUserId, guest_email: null })
      .is("user_id", null)
      .eq("guest_email", normalisedEmail)
      .select("id")
    claimedOrderCount = (claimed ?? []).length
  } catch (err) {
    console.warn("[auth-legacy register-from-guest] bulk-claim failed (non-fatal):", err)
  }

  res.json({ userId: newUserId, claimedOrderCount })
})
