/**
 * Single source of truth for the two outward-facing URLs the API needs:
 *
 *   - API_BASE_URL — where this API is reachable (used for gateway → API
 *     notify/callback webhooks). Set on Railway to the public API host
 *     (e.g. https://api-production-ed3c.up.railway.app).
 *   - SITE_URL — where the storefront is reachable (used for redirect URLs
 *     the customer's browser ends up on after payment). Set to the Vercel
 *     site (e.g. https://realreal-store.vercel.app).
 *
 * Both fall back to the legacy WordPress host so that an unconfigured env
 * doesn't silently send webhooks to localhost in production, but a warning
 * is logged at startup if either is missing.
 */

const LEGACY_SITE = "https://realreal.cc"

function envOrLegacy(name: string): string {
  const v = process.env[name]
  if (v && v.length > 0) return v.replace(/\/+$/, "")
  return LEGACY_SITE
}

export function getApiBaseUrl(): string {
  const v =
    process.env.API_BASE_URL ||
    process.env.API_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  if (v && v.length > 0) return v.replace(/\/+$/, "")
  return envOrLegacy("SITE_URL") // last resort
}

export function getSiteUrl(): string {
  return envOrLegacy("NEXT_PUBLIC_SITE_URL") || envOrLegacy("SITE_URL") || LEGACY_SITE
}
