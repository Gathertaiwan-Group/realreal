import { createClient } from "@supabase/supabase-js"

/**
 * Server-side admin Supabase client (service-role key).
 *
 * Use ONLY from Server Components / Route Handlers — NEVER ship to the
 * browser. The service role bypasses all RLS and can read auth.users, so
 * usage is restricted to admin pages where access is already gated by
 * requireAdmin middleware / the admin layout's auth check.
 *
 * Typical use: looking up emails for a list of user_ids when rendering
 * admin tables (orders / customers / etc.). PostgREST + anon can't read
 * auth.users at all.
 */
export function createAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
