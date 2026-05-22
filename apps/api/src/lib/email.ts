import axios from "axios"

/**
 * Transactional email via Resend (https://resend.com).
 * Requires RESEND_API_KEY; RESEND_FROM_EMAIL must be on a domain verified
 * in the Resend account.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM = process.env.RESEND_FROM_EMAIL ?? "誠真生活 RealReal <love@realreal.cc>"

if (RESEND_API_KEY) {
  console.log("[email] Resend configured, from:", FROM)
} else {
  console.warn("[email] RESEND_API_KEY not set — emails will be logged but not sent")
}

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!RESEND_API_KEY) {
    console.warn(`[email] Skipping send (no Resend config): to=${to} subject="${subject}"`)
    return
  }

  try {
    await axios.post(
      "https://api.resend.com/emails",
      { from: FROM, to, subject, html },
      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
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
