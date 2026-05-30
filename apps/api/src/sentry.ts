import * as Sentry from "@sentry/node"
import { sendLineNotify } from "./lib/line-notify"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
  // Spec M Section 2 — mirror error-level Sentry events to LINE Notify so
  // the operator gets a real-time push without having to watch the Sentry
  // inbox. Fire-and-forget; the function itself swallows transport errors.
  beforeSend(event) {
    if (event.level === "error" || event.level === "fatal") {
      const msg =
        `🚨 線上錯誤\n` +
        `${event.exception?.values?.[0]?.value ?? event.message ?? "unknown"}`
      sendLineNotify(msg).catch(() => {})
    }
    return event
  },
})

export { Sentry }
