import { enqueuePostPaymentJobs } from "../lib/enqueue-post-payment"

/**
 * One-shot backfill for orders whose post-payment side effects didn't run
 * (because of the pre-fix schema bugs). Usage on Railway:
 *
 *   railway run --service api node apps/api/dist/scripts/backfill-post-payment.js <orderId>
 *
 * Idempotent — each downstream operation checks for existing rows.
 */
async function main() {
  const orderId = process.argv[2]
  if (!orderId) {
    console.error("Usage: backfill-post-payment.js <orderId>")
    process.exit(1)
  }

  console.log(`[backfill] running enqueuePostPaymentJobs for ${orderId}`)
  try {
    await enqueuePostPaymentJobs(orderId)
    console.log("[backfill] done")
    process.exit(0)
  } catch (err) {
    console.error("[backfill] failed:", err)
    process.exit(1)
  }
}

void main()
