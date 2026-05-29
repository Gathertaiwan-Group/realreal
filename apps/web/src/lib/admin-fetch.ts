/**
 * Client-side wrapper around fetch() that pulls the current Supabase session
 * and adds an `Authorization: Bearer <jwt>` header. Use from admin pages
 * (client components) when calling the Railway API's requireAuth+requireAdmin
 * routes; cross-origin cookies don't work and the API uses JWT auth anyway.
 */

import { createClient } from "@/lib/supabase/client"

export async function adminFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ""

  const incoming = (init.headers ?? {}) as Record<string, string>
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...incoming,
    Authorization: incoming.Authorization ?? `Bearer ${token}`,
  }

  // Strip the cross-origin cookie hint — irrelevant against a Bearer-auth API.
  const { credentials: _credentials, ...rest } = init
  void _credentials
  return fetch(url, { ...rest, headers })
}
