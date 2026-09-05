import * as Sentry from "@sentry/node"
import { sendAlert } from "./lib/alert"

const dsn = process.env.SENTRY_DSN

Sentry.init({
  dsn,
  tracesSampleRate: 0.1,
  // Gate on "is a DSN configured", NOT on NODE_ENV. Railway does not guarantee
  // it injects NODE_ENV=production, and a NODE_ENV gate fails closed exactly
  // when reporting matters most — a live site silently reporting nothing.
  enabled: Boolean(dsn),
  // Mirror error-level events to the operator's inbox so an outage does not
  // depend on someone happening to watch the Sentry dashboard.
  //
  // This is the SINGLE place alerts are emitted — call sites must NOT also send
  // their own alert for the same incident, or one failure sends several emails
  // and burns the Resend quota shared with customer order mail.
  //
  // sendAlert never throws and applies its own dedupe + hourly cap.
  beforeSend(event) {
    if (event.level === "error" || event.level === "fatal") {
      const first = event.exception?.values?.[0]
      const detail = first?.value ?? event.message ?? "unknown"
      const type = first?.type ?? "Error"
      // Temporarily muted: Amego 發票字軌不足 (invoice number range exhausted) —
      // a known, already-being-handled issue, not something that needs to keep
      // paging the inbox on every issuance attempt. Still captured by Sentry
      // normally (event is returned below); only the email alert is skipped.
      // Remove this guard once a new 字軌 has been applied for.
      if (!detail.includes("字軌")) {
        void sendAlert({
          title: `線上錯誤：${type}`,
          // 訊息本身往往不足以行動 —— 「connect ETIMEDOUT」只說了「某個連線逾時」，
          // 沒說是哪個服務、哪支程式。event 手上就有這些欄位，不帶進信裡等於逼人
          // 每次都去翻 Sentry；而會半夜看信的人通常不會馬上開得了 Sentry。
          body: describeEvent(event, detail),
          // Fingerprint on type+message so a storm of the same error collapses
          // into one email per cooldown window.
          dedupeKey: `${type}:${detail}`,
        })
      }
    }
    return event
  },
})

export { Sentry }

/**
 * 把 Sentry event 裡「能讓人判斷該不該起床處理」的欄位攤平成一段文字。
 *
 * 選這幾項的理由：
 *   component/scope tags — 是 worker 還是 API、哪一段流程（worker.ts 等處會設）
 *   transaction / url    — 哪一支路由觸發的
 *   最上面幾層 stack      — 對外連線逾時時，這是唯一能指出「連的是誰」的線索
 */
function describeEvent(event: SentryEventLike, detail: string): string {
  const lines: string[] = [detail]

  const tags = event.tags ?? {}
  const tagText = Object.entries(tags)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("  ")
  if (tagText) lines.push("", `標記　${tagText}`)

  const where = event.transaction ?? event.request?.url
  if (where) lines.push(`位置　${where}`)

  const frames = event.exception?.values?.[0]?.stacktrace?.frames
  if (frames?.length) {
    // Sentry 的 frames 由外而內排列，最後一個才是拋出點。取最後三層並倒過來，
    // 最相關的放最上面。
    const top = frames
      .slice(-3)
      .reverse()
      .map((f) => `  ${f.function ?? "?"} (${f.filename ?? "?"}:${f.lineno ?? "?"})`)
    lines.push("", "呼叫位置", ...top)
  }

  return lines.join("\n")
}

type SentryEventLike = {
  tags?: Record<string, unknown>
  transaction?: string
  request?: { url?: string }
  exception?: {
    values?: Array<{
      stacktrace?: {
        frames?: Array<{ function?: string; filename?: string; lineno?: number }>
      }
    }>
  }
}
