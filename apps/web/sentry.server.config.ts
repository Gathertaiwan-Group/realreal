import * as Sentry from "@sentry/nextjs"

// Loaded by instrumentation.ts → register() when NEXT_RUNTIME === "nodejs".
// Nothing else imports this file; without that hook it is dead code.
//
// Prefer the non-public SENTRY_DSN: it is read from the real process env at
// runtime, so the DSN can be changed on the host without a rebuild. The
// NEXT_PUBLIC_ fallback is inlined at build time and kept only for
// backwards-compatibility with the existing deploy config.
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  // Gate on "is a DSN configured", NOT on NODE_ENV. Railway/Vercel do not
  // guarantee NODE_ENV=production, and a NODE_ENV gate fails closed exactly
  // when you need reporting most.
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
