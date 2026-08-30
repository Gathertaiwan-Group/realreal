import { supabase } from "./supabase"

/**
 * Bulk-claims every still-unclaimed guest order (`user_id IS NULL`) whose
 * `guest_email` matches the given, already-verified email, attaching them to
 * `userId`. Normalises `first_purchase_applied` across the claimed set first
 * — keeps it on the oldest matching order, clears it on the rest — so the
 * partial unique index `uniq_first_purchase_per_user` doesn't trip when
 * multiple claimed orders would otherwise all have it set.
 *
 * Callers MUST already have verified the caller owns this email before
 * calling this — it does not re-check that itself. Two call sites currently
 * prove ownership two different ways:
 *   - POST /auth/legacy/register-from-guest proves it via a matching
 *     orderNumber supplied by the just-completed checkout flow.
 *   - POST /auth/claim-guest-orders proves it via the verified Supabase
 *     session email (only reachable after email-confirmation succeeds).
 *
 * Non-fatal by design: a failure here must never block account creation or
 * sign-in, so it logs and returns 0 rather than throwing.
 */
export async function claimGuestOrdersForUser(userId: string, email: string): Promise<number> {
  const normalisedEmail = email.toLowerCase()
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
    // earliest one; flip the rest. A user with no prior claimed history has
    // zero of these normally, so this only matters for multi-order guests.
    const firstPurchaseClaimed = rows.filter((r) => r.first_purchase_applied)
    const idsToDemote = firstPurchaseClaimed.slice(1).map((r) => r.id)
    if (idsToDemote.length > 0) {
      await supabase
        .from("orders")
        .update({ first_purchase_applied: false })
        .in("id", idsToDemote)
    }

    const { data: claimed } = await supabase
      .from("orders")
      .update({ user_id: userId, guest_email: null })
      .is("user_id", null)
      .eq("guest_email", normalisedEmail)
      .select("id")
    return (claimed ?? []).length
  } catch (err) {
    console.warn("[claim-guest-orders] bulk-claim failed (non-fatal):", err)
    return 0
  }
}
