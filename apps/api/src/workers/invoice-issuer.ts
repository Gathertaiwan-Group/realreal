import { Worker } from "bullmq"
import { Redis } from "ioredis"
import { runInvoiceIssueJob } from "../lib/issue-invoice"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null })

// The "invoice" *queue* (the producer handle) now lives in lib/queue.ts. It used
// to be declared here, which meant every producer — lib/enqueue-post-payment.ts
// and routes/invoices.ts, both reachable from app.ts — imported this file and so
// started the invoice Worker below inside the API process as well as the worker
// process. This module is now imported only by src/worker.ts.
//
// The job body itself lives in lib/issue-invoice.ts, deliberately free of any
// BullMQ/ioredis import: constructing a Worker connects to Redis at module load,
// which would make the issuing logic untestable without a live Redis (the same
// reason lib/queue.ts builds its queues lazily). Keeping the orchestration in a
// plain module is what lets invoice-issue.test.ts exercise the crash / adoption
// / concurrency paths directly.
//
// ⚠️ Idempotency lives in the DATABASE (migration 0049's claim_invoice_issue),
// not here and not in BullMQ. The `jobId` de-duplication added at the two
// producers is a courtesy that reduces obvious duplicates; it cannot help when
// BullMQ re-delivers a *stalled* job, which is precisely the case that used to
// open a second real invoice. Do not weaken the DB claim on the assumption that
// the queue prevents double delivery — it does not.
export const invoiceWorker = new Worker(
  "invoice",
  async (job) => runInvoiceIssueJob(job.data ?? {}),
  { connection },
)

/** Closed by src/worker.ts during graceful shutdown. */
export const invoiceWorkerConnection = connection
