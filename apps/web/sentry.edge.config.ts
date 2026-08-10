import * as Sentry from "@sentry/nextjs"

// Loaded by instrumentation.ts → register() when NEXT_RUNTIME === "edge".
// Applies to middleware and any route handler with `export const runtime = "edge"`.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  // Gate on DSN presence, not NODE_ENV — see sentry.server.config.ts.
  enabled: Boolean(dsn),
  beforeSend(event) {
    // Scrub PII before sending to Sentry
    if (event.user) {
      event.user.email = undefined
      event.user.ip_address = undefined
      event.user.username = undefined
    }
    if (event.request?.headers) {
      delete event.request.headers["cookie"]
      delete event.request.headers["authorization"]
    }
    return event
  },
})
