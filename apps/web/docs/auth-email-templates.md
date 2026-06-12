# Supabase Auth Email Templates (device-independent recovery & confirmation)

These templates are configured in the **Supabase Dashboard**, not in this
repository. The code changes alone are **not** enough — you must update the
templates below or password-reset / signup-confirmation links will keep using
the old PKCE (`code=...`) flow, which only works on the device that requested
the link.

## Why

The default Supabase email templates emit a PKCE link:

```
{{ .ConfirmationURL }}   ->   {{ .SiteURL }}/auth/confirm?code=<pkce_code>
```

`exchangeCodeForSession(code)` (used by `/auth/callback`) needs the
`code_verifier` cookie that was written into the **same browser** that made the
request. If the user opens the email on another device (very common for
password resets: request on desktop, open on phone) there is no verifier cookie
and the exchange fails.

The **token-hash** flow (`verifyOtp({ token_hash, type })`, used by the new
`/auth/confirm` route handler) does **not** need that cookie, so the link works
on any device.

## Where

Supabase Dashboard → **Authentication** → **Email Templates**.

For each template, edit the link so it points at `/auth/confirm` with
`token_hash={{ .TokenHash }}` and the appropriate `type` + `next`.

### Reset Password

Replace the confirmation link in the **Reset Password** template with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password">
  重設密碼 / Reset password
</a>
```

- `type=recovery` → `/auth/confirm` calls `verifyOtp({ type: "recovery", token_hash })`.
- On success the user is redirected to `next` (`/auth/reset-password`) with a
  valid session, so `resetPasswordAction`'s `updateUser({ password })` works.
- On failure (expired/used link) the user is redirected to
  `/auth/forgot-password?error=link_expired`, which shows a toast.

### Confirm signup

Replace the confirmation link in the **Confirm signup** template with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/">
  確認註冊 / Confirm your email
</a>
```

- `type=signup` → `verifyOtp({ type: "signup", token_hash })`.
- On failure the user is redirected to `/auth/login?error=link_expired`.

### Other templates (optional)

If you use them, the same pattern applies with the matching `type`:

| Template            | `type`         |
| ------------------- | -------------- |
| Magic Link          | `magiclink`    |
| Invite user         | `invite`       |
| Change Email Address| `email_change` |

`type` must be one of the Supabase `EmailOtpType` values:
`signup | invite | magiclink | recovery | email_change | email`
(from `@supabase/auth-js@2.100.1`).

## Site URL / Redirect URLs

Make sure both routes are allowed:

- Supabase Dashboard → **Authentication** → **URL Configuration**
  - **Site URL**: your production origin (matches `NEXT_PUBLIC_SITE_URL`, e.g.
    `https://realreal.cc`).
  - **Redirect URLs**: add `https://realreal.cc/auth/confirm` and
    `https://realreal.cc/auth/callback` (and any preview/localhost origins you
    test against).

## What stays in code

- `forgotPasswordAction` sets `redirectTo` to
  `${siteUrl}/auth/confirm?next=/auth/reset-password`.
- `registerAction` sets `emailRedirectTo` to `${siteUrl}/auth/confirm?next=/`.

These control `{{ .SiteURL }}` / `{{ .RedirectTo }}` for the email, but the
template change above is what actually switches the link to the token-hash flow.

## Same-device PKCE path is preserved

`/auth/callback` (`exchangeCodeForSession`) is intentionally kept. If a link
still arrives with `?code=...` (same device, or a template you haven't migrated
yet), that route continues to work. `/auth/confirm` is the device-independent
addition, not a replacement.
