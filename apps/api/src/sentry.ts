import * as Sentry from "@sentry/node"
import { sendAlert } from "./lib/alert"

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  // Gate on "is a DSN configured", NOT on NODE_ENV. Railway does not guarantee
  // it injects NODE_ENV=production, and a NODE_ENV gate fails closed exactly
  // when reporting matters most — a live site silently reporting nothing.
  enabled: Boolean(dsn),
  // Mirror error-level events to the operator's inbox so an outage does not
  // depend on someone happening to watch the Sentry dashboard.
  //
  // This is the SINGLE place alerts are emitted — call sites must NOT also send
  // their own alert for the same incident, or one failure sends several emails
  // and burns the Resend quota shared with customer order mail.
  //
  // sendAlert never throws and applies its own dedupe + hourly cap.
  beforeSend(event) {
    if (event.level === "error" || event.level === "fatal") {
      const first = event.exception?.values?.[0]
      const detail = first?.value ?? event.message ?? "unknown"
      const type = first?.type ?? "Error"
      // Temporarily muted: Amego 發票字軌不足 (invoice number range exhausted) —
      // a known, already-being-handled issue, not something that needs to keep
      // paging the inbox on every issuance attempt. Still captured by Sentry
      // normally (event is returned below); only the email alert is skipped.
      // Remove this guard once a new 字軌 has been applied for.
      if (!detail.includes("字軌")) {
        void sendAlert({
          title: `線上錯誤：${type}`,
          body: detail,
          // Fingerprint on type+message so a storm of the same error collapses
          // into one email per cooldown window.
          dedupeKey: `${type}:${detail}`,
        })
      }
    }
    return event
  },
})

export { Sentry }
