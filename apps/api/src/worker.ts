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

for (const { name, worker } of workers) {
  worker.on("failed", (job, err) => logger.error({ queue: name, jobId: job?.id, err: err.message }, "job failed"))
  worker.on("error", (err) => logger.error({ queue: name, err: err.message }, "worker error"))
}

registerSchedulers().catch((err) => {
  logger.error({ err: err.message }, "failed to register job schedulers")
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

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, "shutting down workers")
  healthServer.close()
  await Promise.allSettled(workers.map(({ worker }) => worker.close()))
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
