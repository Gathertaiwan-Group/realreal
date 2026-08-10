// Sentry first, so its instrumentation and global handlers are installed before
// anything below is constructed. This is the SAME module the API process uses
// (src/sentry.ts): the `enabled` gate is "is a SENTRY_DSN set", never
// NODE_ENV — Railway does not guarantee it injects NODE_ENV, and a NODE_ENV gate
// fails closed exactly when reporting matters.
//
// Until now the worker had no Sentry at all: BullMQ job failures and worker
// crashes were logged to stdout and nowhere else.
//
// ⚠️ Only `Sentry.captureException` is used below — never `sendAlert`.
// sentry.ts's `beforeSend` is the single place alerts are emailed, and it
// already applies a 15-minute per-fingerprint dedupe plus a 10/hour global cap.
// Alerting here as well would send two emails for one failure and, with
// `attempts: 5` on most jobs, five failed attempts of the SAME job would become
// five emails instead of one.
import { Sentry } from "./sentry"
import http from "http"
import pino from "pino"
import { inventoryQueue } from "./lib/queue"
import { inventoryWorker } from "./workers/inventory-worker"
import { invoiceWorker } from "./workers/invoice-issuer"
import { pointsExpireQueue, pointsExpireWorker } from "./workers/points-expire"
import { subscriptionBillingQueue, subscriptionBillingWorker } from "./workers/subscription-billing"
import { tierExpireQueue, tierExpireWorker } from "./workers/tier-expire"

const logger = pino({
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
})

// ⚠️ KNOWN GAP: subscriptionBillingWorker does NOT actually charge the customer.
// subscription-billing.ts has `// TODO: Call PChomePay Token recurring charge API
// / For now, mark as success`. Running this scheduler will mark subscription
// orders "completed" and send a "billed" email WITHOUT taking any real payment.
// Wiring the PChomePay Token recurring-charge API is out of scope and needs
// payment-gateway sandbox testing before this can be trusted in production.
async function registerSchedulers() {
  // Daily subscription billing sweep (03:00 Asia/Taipei).
  await subscriptionBillingQueue.upsertJobScheduler(
    "daily-billing",
    { pattern: "0 3 * * *", tz: "Asia/Taipei" },
    { name: "daily-billing", data: {} },
  )
  // Daily low-stock check (09:00 Asia/Taipei).
  await inventoryQueue.upsertJobScheduler(
    "low-stock-check",
    { pattern: "0 9 * * *", tz: "Asia/Taipei" },
    { name: "low-stock-check", data: {} },
  )
  // Daily points expiration sweep (03:00 Asia/Taipei).
  await pointsExpireQueue.upsertJobScheduler(
    "daily-points-expire",
    { pattern: "0 3 * * *", tz: "Asia/Taipei" },
    { name: "expire", data: {} },
  )
  // Daily tier expiration sweep (04:00 Asia/Taipei) — renew if requalified,
  // otherwise downgrade. See spec C Section 3.
  await tierExpireQueue.upsertJobScheduler(
    "daily-tier-expire",
    { pattern: "0 4 * * *", tz: "Asia/Taipei" },
    { name: "expire", data: {} },
  )
  logger.info("Job schedulers registered (daily-billing 03:00, low-stock-check 09:00, daily-points-expire 03:00, daily-tier-expire 04:00 Asia/Taipei)")
}

const workers = [
  { name: "inventory", worker: inventoryWorker },
  { name: "invoice", worker: invoiceWorker },
  { name: "points-expire", worker: pointsExpireWorker },
  { name: "subscription-billing", worker: subscriptionBillingWorker },
  { name: "tier-expire", worker: tierExpireWorker },
]

/**
 * Give Sentry a moment to ship queued events before the process dies.
 *
 * `process.exit()` tears the transport down mid-flight, so anything captured on
 * the way out is lost unless we flush first. Never throws and never blocks
 * shutdown for longer than the timeout — a reporting problem must not turn into
 * a worker that refuses to stop. When no DSN is configured this resolves
 * immediately.
 */
const SENTRY_FLUSH_TIMEOUT_MS = 2_000
async function flushSentry(): Promise<void> {
  try {
    await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS)
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "sentry flush failed (non-fatal)")
  }
}

for (const { name, worker } of workers) {
  worker.on("failed", (job, err) => {
    logger.error({ queue: name, jobId: job?.id, err: err.message }, "job failed")
    // Fires once per failed ATTEMPT. Jobs are enqueued with `attempts: 5`, so a
    // single bad job raises this up to five times with the same error — Sentry
    // groups them, and sendAlert's per-fingerprint cooldown collapses them into
    // one email. Nothing extra is needed here, and nothing extra may be added.
    Sentry.captureException(err, {
      tags: { component: "worker", queue: name, job_name: job?.name },
      // Ids and counters only. Job payloads can carry customer data and this
      // codebase has leaked PII before — do not widen this to `job.data`.
      extra: { jobId: job?.id, attemptsMade: job?.attemptsMade },
    })
  })
  worker.on("error", (err) => {
    logger.error({ queue: name, err: err.message }, "worker error")
    // Worker-level failures (Redis dropped, malformed job, handler blew up
    // outside a job). During a Redis outage this can fire repeatedly; the alert
    // module's dedupe + hourly cap is what bounds the email volume.
    Sentry.captureException(err, {
      tags: { component: "worker", queue: name, scope: "worker-error" },
    })
  })
}

registerSchedulers().catch(async (err) => {
  logger.error({ err: err.message }, "failed to register job schedulers")
  // Without this the worker exits 1 on a bad deploy and the only trace is a
  // Railway log line nobody is watching.
  Sentry.captureException(err, {
    tags: { component: "worker", scope: "scheduler-registration" },
  })
  await flushSentry()
  process.exit(1)
})

// Minimal liveness endpoint so Railway's shared /health check passes for the
// worker service (it has no HTTP API otherwise).
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", role: "worker", timestamp: new Date().toISOString() }))
    return
  }
  res.writeHead(404)
  res.end()
})
healthServer.listen(Number(process.env.PORT ?? 4001), () =>
  logger.info({ port: process.env.PORT ?? 4001 }, "worker health server listening"))

logger.info("Worker process started (inventory, invoice, points-expire, subscription-billing, tier-expire)")

/**
 * Graceful shutdown.
 *
 * `worker.close()` (no argument) is the *graceful* form: BullMQ stops taking new
 * jobs and waits for the active one to finish. That is what keeps a deploy from
 * severing an in-flight Amego call.
 *
 * The timeout is not optional. Amego's HTTP timeout is 45s (lib/amego.ts) while
 * Railway's grace period before SIGKILL is far shorter, so an unbounded wait
 * guarantees the platform kills us mid-request — the exact ungraceful case this
 * handler exists to remove. Bounding it means we choose *when* to stop rather
 * than having it chosen for us, and the log line below says which happened.
 *
 * Being killed mid-issue is no longer able to double-issue an invoice either
 * way: the row is left in 'issuing' with issue_attempts incremented, so whoever
 * picks it up next queries Amego by OrderId before issuing anything (migration
 * 0049 + lib/issue-invoice.ts). Graceful shutdown reduces how often we land in
 * that recovery path; it is not what makes it safe.
 */
const SHUTDOWN_TIMEOUT_MS = 20_000
let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, "shutting down workers: waiting for in-flight jobs")
  healthServer.close()

  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SHUTDOWN_TIMEOUT_MS)
  })

  const drained = Promise.allSettled(workers.map(({ worker }) => worker.close())).then(
    () => "drained" as const,
  )

  const outcome = await Promise.race([drained, timedOut])
  if (timer) clearTimeout(timer)

  if (outcome === "timeout") {
    logger.warn(
      { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
      "in-flight jobs did not finish in time; exiting anyway (stale claims are reclaimed by reclaim_stale_invoices)",
    )
  } else {
    logger.info({ signal }, "all workers drained")
  }

  // Anything captured while draining (a job failing as it is cancelled) would
  // otherwise die with the transport.
  await flushSentry()
  logger.info({ signal }, "worker shutdown complete")
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
