import * as Sentry from "@sentry/nextjs"

/**
 * Browser-side Sentry init.
 *
 * This replaces `sentry.client.config.ts`, which is deprecated in @sentry/nextjs
 * v9+ and — critically — is NOT picked up when the app is built with Turbopack.
 * This repo builds with Turbopack (Next 16 defaults to it; the build banner
 * reads "▲ Next.js 16.2.1 (Turbopack)"), so the old file was inert too.
 *
 * `instrumentation-client.ts` is the supported entry point and is loaded by the
 * Next.js client bootstrap regardless of bundler.
 */

// Must be the inlined NEXT_PUBLIC_* var — this code runs in the browser, where
// there is no process.env to read at runtime.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 1.0,
  // Gate on "is a DSN configured", NOT on NODE_ENV. Deploy targets do not
  // reliably inject NODE_ENV=production, and a NODE_ENV gate fails closed in
  // exactly the situation you need reporting most: a live site that silently
  // reports nothing.
  enabled: Boolean(dsn),
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
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

// Required by @sentry/nextjs to instrument App Router client-side navigations.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
