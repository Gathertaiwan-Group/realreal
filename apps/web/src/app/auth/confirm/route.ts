import { createClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import type { EmailOtpType } from "@supabase/supabase-js"

// Device-independent email confirmation / password recovery.
//
// Unlike /auth/callback (which uses the PKCE `exchangeCodeForSession(code)`
// flow and therefore needs the `code_verifier` cookie written into the SAME
// browser that requested the link), this handler uses the token-hash flow:
// `verifyOtp({ token_hash, type })`. That call does NOT need the PKCE verifier
// cookie, so the link works even when the email is opened on a different device
// (e.g. request a password reset on desktop, open it on a phone).
//
// Requires the Supabase email templates to emit token-hash links, e.g.
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password
// See docs/auth-email-templates.md for the exact dashboard configuration.

// `verifyOtp` for an email link accepts `EmailOtpType`:
//   'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'
// (from @supabase/auth-js@2.100.1 — VerifyTokenHashParams).
const VALID_OTP_TYPES: ReadonlySet<EmailOtpType> = new Set([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
])

// Only allow same-origin relative paths. An attacker-supplied absolute or
// protocol-relative URL (?next=//evil.example) would otherwise bounce the
// freshly-authenticated user to a phishing site.
function safeNext(raw: string | null, fallback: string): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw
  return fallback
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const typeParam = searchParams.get("type") as EmailOtpType | null
  const isRecovery = typeParam === "recovery"

  // Recovery failures should send the user back to where they can re-request a
  // link; everything else goes to login. Both surface ?error=link_expired.
  const errorRedirect = isRecovery
    ? `${origin}/auth/forgot-password?error=link_expired`
    : `${origin}/auth/login?error=link_expired`

  // After a successful recovery the user must set a new password; other
  // confirmations (signup, etc.) default to the home page.
  const next = safeNext(searchParams.get("next"), isRecovery ? "/auth/reset-password" : "/")

  if (!tokenHash || !typeParam || !VALID_OTP_TYPES.has(typeParam)) {
    return NextResponse.redirect(errorRedirect)
  }

  const supabase = await createClient()
  // verifyOtp({ token_hash, type }) verifies the link and, on success, persists
  // the session through the cookie-backed server client — no PKCE verifier
  // cookie required, so this works cross-device.
  const { error } = await supabase.auth.verifyOtp({ type: typeParam, token_hash: tokenHash })

  if (error) {
    return NextResponse.redirect(errorRedirect)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
