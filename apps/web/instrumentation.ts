import * as Sentry from "@sentry/nextjs"

/**
 * Next.js instrumentation hook — the ONLY load path for server/edge Sentry.
 *
 * Why this file has to exist: `withSentryConfig` in next.config.ts only does
 * build-time work (bundling the client config, wrapping route handlers,
 * uploading source maps). It does NOT execute `sentry.server.config.ts` or
 * `sentry.edge.config.ts`. Without this `register()` those two files are dead
 * code — nothing imports them — so `Sentry.init()` never runs on the server and
 * every production server error goes unreported. That was the state of this repo
 * until 2026-08-10; verified empirically (0 envelopes emitted from a throwing
 * route handler against a local ingest endpoint).
 *
 * `onRequestError` is the Next 15+/16 hook that forwards server-side render and
 * route-handler errors into Sentry. It is separate from `register()` — having
 * the SDK initialised is necessary but not sufficient.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config")
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config")
  }
}

export const onRequestError = Sentry.captureRequestError
