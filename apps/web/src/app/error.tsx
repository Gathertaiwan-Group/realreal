"use client"

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

/**
 * Page-level error boundary — everything inside the storefront layout.
 *
 * It must report to Sentry itself. `onRequestError` in instrumentation.ts only
 * sees errors thrown during a server render; anything that throws in the
 * browser reaches this boundary and nowhere else. A customer hit this screen
 * mid-checkout on 2026-09-07 (order #10000217) and the only record of it was
 * the screenshot they sent — no event, no alert email, no page URL. The digest
 * shown below is useless on its own; the captured event carries the URL.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "app/error" },
      extra: {
        digest: error.digest,
        url: typeof window === "undefined" ? undefined : window.location.href,
      },
    })
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-bold text-zinc-800">發生錯誤</h1>
      <p className="mt-4 text-zinc-600">很抱歉，載入頁面時發生了問題。</p>
      {error.digest && (
        <p className="mt-2 text-xs text-zinc-400">錯誤代碼：{error.digest}</p>
      )}
      <button
        onClick={reset}
        className="mt-8 rounded-md bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
      >
        重新載入
      </button>
    </div>
  )
}
