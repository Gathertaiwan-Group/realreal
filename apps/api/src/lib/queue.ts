import { Queue } from "bullmq"
import { Redis } from "ioredis"

/**
 * BullMQ *producer* handles.
 *
 * Producers (queues) live here; consumers (Workers) live in src/workers/ and are
 * only ever constructed by src/worker.ts. Keeping the two apart is deliberate:
 * the "invoice" queue used to be declared inside workers/invoice-issuer.ts right
 * next to its Worker, so every module that merely wanted to *enqueue* an invoice
 * job (lib/enqueue-post-payment.ts, routes/invoices.ts — both reachable from
 * app.ts) dragged the invoice Worker into the API process as an import side
 * effect. The API service was therefore also *consuming* invoice jobs, and its
 * shutdown path never closed that Worker.
 *
 * Both handles are built LAZILY, on first property access. That is load-bearing,
 * not a micro-optimisation:
 *
 *   `new Queue(...)` connects immediately. BullMQ's RedisConnection.init() calls
 *   waitUntilReady(), which calls client.connect() even when the ioredis client
 *   was created with `lazyConnect: true` — so the laziness has to live at the
 *   Queue level; no ioredis option can defer it.
 *
 *   Importing app.ts reaches this module (routes/orders.ts → here). 14 apps/api
 *   test files import app.ts without mocking this module, so each of them opened
 *   Redis sockets to a server that is not running under test. ioredis then
 *   retries forever (`maxRetriesPerRequest: null`) and the `error` handler below
 *   console.error's on every attempt. Vitest ships console output from the test
 *   worker to the main process over RPC (`onUserConsoleLog`), and nothing ever
 *   closed these connections — so retries kept firing after the test file had
 *   finished, and one landing inside the worker-teardown window aborted the run:
 *
 *     EnvironmentTeardownError: [vitest-worker]: Closing rpc while
 *     "onUserConsoleLog" was pending
 *
 *   i.e. exit code 1 with 256/256 tests passing (2 of 20 local runs; it turned
 *   CI red on e0407c9). Building the queue lazily means a process that never
 *   enqueues anything never opens a socket, so there is no stray async work left
 *   to race with teardown. Note this is a *cleanup* fix, not a retry/serialise
 *   workaround: a genuine test failure still fails exactly as before.
 *
 * Production behaviour is unchanged apart from *when* the socket opens: the
 * first `.add()` / `.upsertJobScheduler()` connects, and every call site already
 * awaits those.
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379"

function createConnection(label: string): Redis {
  const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
  connection.on("error", (err) => {
    console.error(`[queue:${label}] Redis connection error (non-fatal):`, err.message)
  })
  return connection
}

/**
 * A Queue constructed on first property access.
 *
 * Methods are bound to the real Queue instance before being handed out, so
 * `this` inside BullMQ is never the proxy (private fields keep working).
 */
function lazyQueue(name: string): Queue {
  let instance: Queue | undefined
  const resolve = (): Queue =>
    (instance ??= new Queue(name, { connection: createConnection(name) }))

  return new Proxy({} as Queue, {
    get(_target, prop) {
      const queue = resolve() as unknown as Record<string | symbol, unknown>
      const value = queue[prop]
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(queue)
        : value
    },
  })
}

export const inventoryQueue = lazyQueue("inventory")
export const invoiceQueue = lazyQueue("invoice")
