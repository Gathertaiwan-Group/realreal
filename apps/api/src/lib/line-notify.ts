import axios from "axios"
import { getSettingOrEnv } from "./settings"

/**
 * Push a one-line notification to LINE Notify.
 *
 * Spec: docs/superpowers/specs/2026-05-31-M-meta-pixel-clarity-line-notify-design.md
 *
 * - Token resolution: app_settings("notifications.line_notify_token")
 *   with fallback to process.env.LINE_NOTIFY_TOKEN.
 * - If no token is configured, silently no-ops (so dev / staging without
 *   a token don't spam warnings).
 * - 5s timeout, non-fatal on failure. LINE Notify outages must NEVER break
 *   the order flow or the Sentry pipeline that calls us.
 */
export async function sendLineNotify(message: string): Promise<void> {
  try {
    const token = await getSettingOrEnv(
      "notifications.line_notify_token",
      "LINE_NOTIFY_TOKEN",
    )
    if (!token) return // silently skip if not configured

    await axios.post(
      "https://notify-api.line.me/api/notify",
      new URLSearchParams({ message }).toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 5000,
      },
    )
  } catch (err) {
    // Non-fatal: log + continue. Don't let LINE outage break order flow.
    console.warn("[line-notify] failed:", err)
  }
}
