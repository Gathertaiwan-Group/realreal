"use client" // Error boundaries must be Client Components

import * as Sentry from "@sentry/nextjs"
import { useEffect } from "react"

/**
 * Catches errors thrown by the root layout itself — the one class of error that
 * `app/error.tsx` cannot see, because that boundary lives *inside* the layout.
 * Without this file those errors reach nobody: React swallows them into a
 * generic browser-level failure and Sentry is never told.
 *
 * Must render its own <html>/<body>: it replaces the root layout when active.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="zh-TW">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <h1 className="text-4xl font-bold text-zinc-800">發生錯誤</h1>
          <p className="mt-4 text-zinc-600">很抱歉，載入頁面時發生了問題。</p>
          {error.digest && (
            <p className="mt-2 text-xs text-zinc-400">錯誤代碼：{error.digest}</p>
          )}
          <button
            onClick={() => unstable_retry()}
            className="mt-8 rounded-md bg-zinc-900 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            重新載入
          </button>
        </div>
      </body>
    </html>
  )
}
