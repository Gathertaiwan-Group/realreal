import { Worker, Queue } from "bullmq"
import { Redis } from "ioredis"
import { supabase } from "../lib/supabase"
import { decryptToken } from "../lib/token-encryption"
import { renderAndSendEmail } from "./email-sender"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null })

export const subscriptionBillingQueue = new Queue("subscription-billing", { connection })

// Idempotency key: sub_{subscriptionId}_{YYYY-MM-DD} in Asia/Taipei
export function buildIdempotencyKey(subscriptionId: string, date: Date = new Date()): string {
  const taipeiDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(date)
  return `sub_${subscriptionId}_${taipeiDate}`
}

export function computeNextBillingDate(interval: string, from: Date = new Date()): Date {
  const next = new Date(from)
  next.setDate(next.getDate() + (interval === "monthly" ? 30 : 60))
  return next
}

async function processSingleSubscription(subscriptionId: string) {
  const idempotencyKey = buildIdempotencyKey(subscriptionId)

  // Idempotency check
  const { data: existing } = await supabase
    .from("subscription_orders")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .single()

  if (existing) return { skipped: true, reason: "already_processed" }

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("*, subscription_plans(interval, price, name)")
    .eq("id", subscriptionId)
    .single()

  if (!sub || sub.status !== "active") return { skipped: true }

  // Create subscription_orders record first (idempotency guard)
  const { data: subOrder, error: insertError } = await supabase
    .from("subscription_orders")
    .insert({
      subscription_id: subscriptionId,
      billing_cycle: 1,
      idempotency_key: idempotencyKey,
      status: "pending",
    })
    .select()
    .single()

  if (insertError?.code === "23505") return { skipped: true, reason: "duplicate" }
  if (insertError) throw insertError

  const plan = sub.subscription_plans as any

  try {
    // Decrypt token (PChomePay Token API call would go here).
    const _token = await decryptToken(sub.payment_method_token ?? "")

    // NOTE: Real PChomePay Token recurring charge is NOT implemented yet — see
    // the pending PChomePay Token API integration. We must NOT pretend the
    // cycle was charged: previously this path marked the order "completed",
    // advanced next_billing_date, and emailed the customer "扣款成功" while
    // charging nothing. Until the Token API is wired up, leave the cycle in a
    // state an admin can act on (subscription_orders row stays "pending",
    // next_billing_date is NOT advanced) and send no success/charged email.
    console.warn(
      `[subscription-billing] recurring charge not implemented — skipping order ${subOrder!.id} (subscription ${subscriptionId}), needs manual handling`,
    )

    return { skipped: true, reason: "charge_not_implemented" }

  } catch (err: any) {
    const newRetryCount = (sub.retry_count ?? 0) + 1
    const newStatus = newRetryCount >= 3 ? "past_due" : "active"

    await supabase.from("subscriptions").update({
      retry_count: newRetryCount,
      status: newStatus,
    }).eq("id", subscriptionId)

    await supabase.from("subscription_orders").update({ status: "failed" }).eq("id", subOrder!.id)

    // Send failure notification email. Email lives in auth.users — there is no
    // public.users table — so resolve it via the admin API.
    try {
      const {
        data: { user },
      } = await supabase.auth.admin.getUserById(sub.user_id)

      if (user?.email) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"
        const retryDate = new Date()
        retryDate.setDate(retryDate.getDate() + 3)
        await renderAndSendEmail({
          template: "subscription-failed",
          to: user.email,
          data: {
            planName: plan.name,
            retryDate: retryDate.toISOString().split("T")[0],
            manageUrl: `${siteUrl}/account/subscriptions`,
          },
        })
      }
    } catch (emailErr) {
      console.warn("[subscription-billing] failed to enqueue failure email:", emailErr)
    }

    throw err
  }
}

export const subscriptionBillingWorker = new Worker("subscription-billing", async (job) => {
  if (job.name === "daily-billing") {
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date())
    const { data: subs } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("status", "active")
      .lte("next_billing_date", today)

    const results = await Promise.allSettled((subs ?? []).map(s => processSingleSubscription(s.id)))
    return { processed: results.length }
  }

  if (job.name === "bill-subscription") {
    return processSingleSubscription(job.data.subscriptionId)
  }
}, { connection })
