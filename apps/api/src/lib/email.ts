import axios from "axios"
import { getSettingOrEnv } from "./settings"

/**
 * Transactional email via Resend (https://resend.com).
 * Credentials resolved at send-time from /admin/settings, falling back to
 * RESEND_API_KEY / RESEND_FROM_EMAIL env vars. Admin-edited values take
 * effect within ~30s (settings cache TTL).
 */

async function getEmailCreds() {
  const [apiKey, fromAddress, fromName] = await Promise.all([
    getSettingOrEnv("resend.api_key", "RESEND_API_KEY"),
    getSettingOrEnv("resend.from_address", "RESEND_FROM_EMAIL", "love@realreal.cc"),
    getSettingOrEnv("resend.from_name", "RESEND_FROM_NAME", "誠真生活 RealReal"),
  ])
  // Build the RFC-5322 "Name <addr>" form. Allow the admin to either set the
  // bare address and let us decorate, OR set the entire decorated string
  // in from_address; the simple regex below detects which case we're in.
  const from = /<.+@.+>/.test(fromAddress)
    ? fromAddress
    : `${fromName} <${fromAddress}>`
  return { apiKey, from }
}

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  const { apiKey, from } = await getEmailCreds()
  if (!apiKey) {
    console.warn(`[email] Skipping send (no Resend config): to=${to} subject="${subject}"`)
    return
  }

  try {
    await axios.post(
      "https://api.resend.com/emails",
      { from, to, subject, html },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    )
    console.log(`[email] Sent: to=${to} subject="${subject}"`)
  } catch (err) {
    const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data) : String(err)
    console.error(`[email] Failed to send: to=${to} subject="${subject}" — ${detail}`)
    throw err
  }
}
