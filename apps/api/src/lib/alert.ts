import { getSetting, getSettingOrEnv } from "./settings"
import { sendEmail, parseRecipients } from "./email"

/**
 * Operational alerting — replaces the old LINE Notify push.
 *
 * LINE Notify was shut down by LINE on 2025-03-31; `notify-api.line.me` is a
 * dead endpoint, so every "line上炸了" alert since then has gone nowhere.
 * Alerts now go out over the same Resend transport used for transactional mail.
 *
 * Because alerts share a send quota with customer order/shipping mail, an error
 * storm must never be allowed to burn that quota — otherwise an observability
 * problem escalates into a revenue problem (shipping notifications stop going
 * out). Three guards enforce that:
 *
 *   1. Per-fingerprint cooldown  — the same error alerts at most once per 15 min.
 *   2. Global hourly cap         — at most 10 alert emails per hour, total.
 *   3. Re-entrancy guard         — an alert that itself fails cannot trigger a
 *                                  new alert about that failure (Sentry's
 *                                  beforeSend would otherwise recurse forever).
 *
 * This function NEVER throws and NEVER rejects. Callers (including Sentry's
 * beforeSend) must be able to fire-and-forget it without wrapping it.
 */

const DEDUPE_WINDOW_MS = 15 * 60 * 1000
const GLOBAL_WINDOW_MS = 60 * 60 * 1000
const GLOBAL_MAX_PER_WINDOW = 10

const lastSentByKey = new Map<string, number>()
let globalWindowStart = 0
let globalCount = 0
let sending = false

/** Test seam: reset throttle state. Not used in production code paths. */
export function __resetAlertThrottle(): void {
  lastSentByKey.clear()
  globalWindowStart = 0
  globalCount = 0
  sending = false
}

function shouldSend(dedupeKey: string, now: number): boolean {
  // 1) per-fingerprint cooldown
  const last = lastSentByKey.get(dedupeKey)
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return false

  // 2) global hourly cap
  if (now - globalWindowStart >= GLOBAL_WINDOW_MS) {
    globalWindowStart = now
    globalCount = 0
  }
  if (globalCount >= GLOBAL_MAX_PER_WINDOW) {
    if (globalCount === GLOBAL_MAX_PER_WINDOW) {
      globalCount++ // log the "suppressing" line exactly once per window
      console.warn(
        `[alert] hourly cap (${GLOBAL_MAX_PER_WINDOW}) reached — suppressing further alert emails until the window resets. Check Sentry directly.`,
      )
    }
    return false
  }

  lastSentByKey.set(dedupeKey, now)
  globalCount++
  return true
}

/** Resolve alert recipients: ALERT_EMAIL env wins, else the admin notification inbox. */
async function resolveRecipients(): Promise<string[]> {
  const explicit = parseRecipients(
    await getSettingOrEnv("notifications.alert_email", "ALERT_EMAIL"),
  )
  if (explicit.length > 0) return explicit
  return parseRecipients(await getSetting("notifications.admin_email"))
}

export async function sendAlert({
  title,
  body,
  dedupeKey,
}: {
  title: string
  body: string
  dedupeKey?: string
}): Promise<void> {
  // 3) re-entrancy guard — must be first, and must be released in `finally`.
  if (sending) return
  const key = dedupeKey ?? title
  if (!shouldSend(key, Date.now())) return

  sending = true
  try {
    const to = await resolveRecipients()
    if (to.length === 0) {
      // Disabled path: no recipient configured. Log and move on — never throw,
      // never break the caller.
      console.warn(`[alert] no recipient configured, skipping: ${title}`)
      return
    }

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px">
        <h2 style="color:#b91c1c;margin:0 0 8px">🚨 ${escapeHtml(title)}</h2>
        <pre style="white-space:pre-wrap;word-break:break-word;background:#f4f4f5;padding:12px;border-radius:6px;font-size:13px;color:#27272a">${escapeHtml(body)}</pre>
        <p style="margin:16px 0 0;font-size:12px;color:#687279">
          本信由系統自動送出。同一錯誤 15 分鐘內只寄一次，每小時最多 ${GLOBAL_MAX_PER_WINDOW} 封；
          完整錯誤列表請看 Sentry。
        </p>
      </div>
    `
    await sendEmail({ to, subject: `[RealReal] ${title}`, html })
  } catch (err) {
    // Swallow. An alert that fails must not take down the request that
    // triggered it, and must not itself become a new alert.
    console.warn("[alert] failed to send (non-fatal):", err)
  } finally {
    sending = false
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
