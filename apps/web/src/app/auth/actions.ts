"use server"

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { z } from "zod"

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
})

function getSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc").replace(/\/+$/, "")
}

export async function loginAction(_prev: unknown, formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })
  if (!parsed.success) return { error: "請填入有效的 Email 和密碼（至少 8 字元）" }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) return { error: error.message }

  // Only allow same-origin relative paths. An attacker-supplied absolute or
  // protocol-relative URL (?redirect=//evil.example) would otherwise bounce the
  // freshly-authenticated user to a phishing site.
  const requested = (formData.get("redirectTo") as string) || "/"
  const redirectTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/"
  redirect(redirectTo)
}

export async function registerAction(_prev: unknown, formData: FormData) {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: formData.get("displayName"),
  })
  if (!parsed.success) return { error: "請確認所有欄位填寫正確" }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      // Point signup confirmation at the device-independent token-hash handler
      // so the confirm link works even when opened on a different device. As
      // with recovery, the Supabase dashboard "Confirm signup" email template
      // MUST use the token-hash URL:
      //   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/
      // (See docs/auth-email-templates.md.) The /auth/callback PKCE route still
      // works for the same-device case.
      emailRedirectTo: `${getSiteUrl()}/auth/confirm?next=/`,
    },
  })
  if (error) return { error: error.message }
  return { success: "註冊成功！請檢查您的信箱並點擊確認連結以完成註冊" }
}

export async function forgotPasswordAction(_prev: unknown, formData: FormData) {
  const parsed = z.object({ email: z.string().email() }).safeParse({
    email: formData.get("email"),
  })
  if (!parsed.success) return { error: "請輸入有效的 Email" }
  const email = parsed.data.email

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Point recovery at the device-independent token-hash handler so the reset
    // link works even when opened on a different device than the one that
    // requested it (e.g. request on desktop, open on phone). /auth/confirm uses
    // verifyOtp({ token_hash, type }) which does NOT need the PKCE verifier
    // cookie, unlike the /auth/callback exchangeCodeForSession path.
    //
    // IMPORTANT: this `redirectTo` only sets {{ .SiteURL }} / {{ .RedirectTo }}
    // for the email; it does NOT by itself switch the email to the token-hash
    // link. The Supabase dashboard "Reset Password" email template MUST be set
    // to use the token-hash URL:
    //   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password
    // See docs/auth-email-templates.md for the full dashboard instructions.
    redirectTo: `${getSiteUrl()}/auth/confirm?next=/auth/reset-password`,
  })
  if (error) return { error: error.message }

  return { success: "重設密碼連結已寄出，請檢查您的信箱" }
}

export async function resetPasswordAction(_prev: unknown, formData: FormData) {
  const parsed = z.object({
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
  }).safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  })
  if (!parsed.success) return { error: "密碼至少需要 8 個字元" }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { error: "兩次輸入的密碼不一致" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { error: error.message }

  redirect("/")
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/")
}
