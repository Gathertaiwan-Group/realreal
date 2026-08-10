import "./sentry"
import pino from "pino"
import { app } from "./app"

const logger = pino({
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty" } : undefined,
})

const PORT = Number(process.env.PORT ?? 4000)
const server = app.listen(PORT, () => logger.info({ port: PORT }, "API server started"))

/**
 * Graceful shutdown.
 *
 * Railway sends SIGTERM on every deploy and waits a short grace period before
 * SIGKILL. Until now this process had no handler at all, so the default
 * behaviour applied: immediate termination, tearing down in-flight HTTP
 * requests mid-response. For this API that includes payment and logistics
 * webhooks — a gateway that does not get its 200 retries, and a retried webhook
 * re-runs the post-payment fan-out (invoice enqueue included).
 *
 * `server.close()` stops accepting new connections and lets in-flight requests
 * finish. The timeout is the backstop: a hung request must not keep the process
 * alive until the platform SIGKILLs it, because SIGKILL is precisely the
 * ungraceful case we are removing.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000
let shuttingDown = false

function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ signal }, "API shutting down: draining in-flight requests")

  const forced = setTimeout(() => {
    logger.warn({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, "API shutdown timed out, forcing exit")
    process.exit(0)
  }, SHUTDOWN_TIMEOUT_MS)
  forced.unref()

  server.close(() => {
    logger.info({ signal }, "API shutdown complete")
    process.exit(0)
  })
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
