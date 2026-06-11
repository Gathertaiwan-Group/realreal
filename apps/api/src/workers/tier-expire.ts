/**
 * Tier expiration worker — daily 04:00 Asia/Taipei sweep.
 *
 * For every `user_profiles` row whose `tier_expires_at` has passed AND that has
 * a membership tier assigned:
 *   - if `tier_period_spend >= membership_tier.requalify_amount` → renew at the
 *     same tier (new `tier_started_at`, recompute `tier_expires_at`, reset
 *     `tier_period_spend`). Send the `tier-renewed` email.
 *   - else → cascade downgrade to the highest tier whose requalify_amount is
 *     met by the expired period spend; if none match, fall back to the lowest
 *     tier. Reset start/expiry/period. Send the `tier-downgraded` email.
 *
 * Spec reference: docs/superpowers/specs/2026-05-30-C-tier-overhaul-design.md
 * (Section 3 — `workers/tier-expire.ts`).
 */
import { Worker, Queue } from "bullmq"
import { Redis } from "ioredis"
import { supabase } from "../lib/supabase"
import { addMonths } from "../lib/tier"
import { renderAndSendEmail } from "./email-sender"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null })

export const tierExpireQueue = new Queue("tier-expire", { connection })

type ExpiredRow = {
  user_id: string
  membership_tier_id: string | null
  tier_period_spend: number | string | null
  membership_tiers: {
    id: string
    name: string
    min_spend: number | string
    validity_months: number | null
    requalify_amount: number | string | null
    requalify_window_months: number | null
  } | null
}

type TargetTierRow = {
  id: string
  name: string
  min_spend: number | string
  validity_months: number | null
}

async function lookupEmail(userId: string): Promise<string | null> {
  // Email lives in auth.users — there is no public.users table. Fetch via the
  // admin API (same pattern as enqueue-post-payment.ts).
  const {
    data: { user },
  } = await supabase.auth.admin.getUserById(userId)
  return user?.email ?? null
}

export const tierExpireWorker = new Worker(
  "tier-expire",
  async (job) => {
    if (job.name !== "expire") return

    const now = new Date()
    const nowIso = now.toISOString()

    const { data: expired, error } = await supabase
      .from("user_profiles")
      .select(
        "user_id, membership_tier_id, tier_period_spend, membership_tiers(id, name, min_spend, validity_months, requalify_amount, requalify_window_months)",
      )
      .not("membership_tier_id", "is", null)
      .not("tier_expires_at", "is", null)
      .lt("tier_expires_at", nowIso)

    if (error) throw new Error(`tier-expire query failed: ${error.message}`)

    const rows = (expired ?? []) as unknown as ExpiredRow[]

    let renewed = 0
    let downgraded = 0
    let skipped = 0

    for (const row of rows) {
      const tier = row.membership_tiers
      if (!tier) {
        // Stale FK or missing join — skip rather than crash the sweep.
        skipped++
        continue
      }

      const periodSpend = Number(row.tier_period_spend ?? 0)
      const requalify = Number(tier.requalify_amount ?? 0)
      const meetsRequalify = periodSpend >= requalify

      if (meetsRequalify) {
        // ── Renew at the same tier ──
        const validity = Number(tier.validity_months ?? 0)
        const newExpiresAt = validity > 0 ? addMonths(now, validity).toISOString() : null

        const { error: updErr } = await supabase
          .from("user_profiles")
          .update({
            tier_started_at: nowIso,
            tier_expires_at: newExpiresAt,
            tier_period_spend: 0,
          })
          .eq("user_id", row.user_id)
        if (updErr) {
          console.warn(`[tier-expire] renew update failed for ${row.user_id}: ${updErr.message}`)
          continue
        }

        const email = await lookupEmail(row.user_id)
        if (email) {
          try {
            await renderAndSendEmail({
              template: "tier-renewed" as any,
              to: email,
              data: {
                userId: row.user_id,
                tierName: tier.name,
                newExpiresAt: newExpiresAt ?? "永久",
              } as any,
            })
          } catch (emailErr: any) {
            console.warn(`[tier-expire] renewed email failed for ${row.user_id}: ${emailErr?.message}`)
          }
        }
        renewed++
        continue
      }

      // ── Cascade downgrade to the highest still-qualified tier ──
      const { data: qualified, error: qualifiedErr } = await supabase
        .from("membership_tiers")
        .select("id, name, min_spend, validity_months, requalify_amount")
        .lt("min_spend", tier.min_spend)
        .lte("requalify_amount", periodSpend)
        .order("min_spend", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (qualifiedErr) {
        console.warn(`[tier-expire] qualified-tier lookup failed for ${row.user_id}: ${qualifiedErr.message}`)
        continue
      }

      let targetTier = qualified as TargetTierRow | null
      if (!targetTier) {
        const { data: lowest, error: lowestErr } = await supabase
          .from("membership_tiers")
          .select("id, name, min_spend, validity_months")
          .order("min_spend", { ascending: true })
          .limit(1)
          .maybeSingle()
        if (lowestErr || !lowest) {
          console.warn(`[tier-expire] lowest-tier lookup failed for ${row.user_id}: ${lowestErr?.message ?? "missing lowest tier"}`)
          continue
        }
        targetTier = lowest as TargetTierRow
      }

      const lowerValidity = Number(targetTier.validity_months ?? 0)
      const newExpiresAt = lowerValidity > 0 ? addMonths(now, lowerValidity).toISOString() : null

      const { error: dgErr } = await supabase
        .from("user_profiles")
        .update({
          membership_tier_id: targetTier.id,
          tier_started_at: nowIso,
          tier_expires_at: newExpiresAt,
          tier_period_spend: 0,
        })
        .eq("user_id", row.user_id)
      if (dgErr) {
        console.warn(`[tier-expire] downgrade update failed for ${row.user_id}: ${dgErr.message}`)
        continue
      }

      const email = await lookupEmail(row.user_id)
      if (email) {
        try {
          await renderAndSendEmail({
            template: "tier-downgraded" as any,
            to: email,
            data: {
              userId: row.user_id,
              fromTier: tier.name,
              toTier: targetTier.name,
              newExpiresAt: newExpiresAt ?? "永久",
            } as any,
          })
        } catch (emailErr: any) {
          console.warn(`[tier-expire] downgrade email failed for ${row.user_id}: ${emailErr?.message}`)
        }
      }
      downgraded++
    }

    const summary = {
      checked: rows.length,
      renewed,
      downgraded,
      skipped,
      at: nowIso,
    }
    console.log(
      `[tier-expire] checked ${summary.checked} expired profile(s): renewed ${summary.renewed}, downgraded ${summary.downgraded}, skipped ${summary.skipped} at ${summary.at}`,
    )
    return summary
  },
  { connection },
)
