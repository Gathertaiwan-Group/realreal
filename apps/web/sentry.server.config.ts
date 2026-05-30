import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
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
