"use client"

import { useActionState, useEffect, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { loginAction } from "../actions"
import Link from "next/link"
import Image from "next/image"

const REMEMBER_ME_KEY = "realreal-remember-me"

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null)
  const searchParams = useSearchParams()

  // 「記住帳號密碼」勾選框 — 預設勾起來（多數使用者想要的行為）。
  // 只把勾選狀態本身寫到 localStorage；密碼從不存在 localStorage，永遠
  // 走瀏覽器原生密碼管理員（autoComplete + Credential Management API）。
  //
  // 寫入 localStorage 只發生在 user 互動（toggleRemember）— 不放在
  // useEffect 內，避免「restore effect 跟 save effect」在 mount 時的
  // ordering race（save 跑在 restore 完成的 setState 之前，會把 LS 從
  // "0" 反向覆蓋成 "1"）。
  const [rememberMe, setRememberMe] = useState(true)
  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem(REMEMBER_ME_KEY)
    if (saved !== null) setRememberMe(saved === "1")
  }, [])
  function toggleRemember(checked: boolean) {
    setRememberMe(checked)
    if (typeof window !== "undefined") {
      localStorage.setItem(REMEMBER_ME_KEY, checked ? "1" : "0")
    }
  }

  // Submit-time side effect: when 「記住我」勾起來，明確呼叫 Credential
  // Management API 把帳密交給瀏覽器密碼管理員。autoComplete 屬性已負責
  // 自動提示「儲存密碼？」；這一步把 PasswordCredential 也送進來，讓
  // 支援的瀏覽器（Chrome / Edge / Brave）下次能 silent autofill。Safari /
  // Firefox 沒 PasswordCredential 會 throw → try/catch 接住，靠原生 autofill。
  // 不 preventDefault，讓 React 19 的 form action 接著跑。
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (!rememberMe) return
    if (typeof window === "undefined") return
    if (!("credentials" in navigator) || !("PasswordCredential" in window)) return
    const formData = new FormData(e.currentTarget)
    const email = String(formData.get("email") ?? "")
    const password = String(formData.get("password") ?? "")
    if (!email || !password) return
    try {
      // @ts-expect-error - PasswordCredential not in default TS lib.dom types
      const cred = new window.PasswordCredential({ id: email, password, name: email })
      void navigator.credentials.store(cred)
    } catch {
      /* unsupported browser → silently fall back to autoComplete */
    }
  }
  // The proxy/middleware bounces unauthenticated users here with `?next=`;
  // accept the legacy `?redirect=` too. (Previously only `redirect` was read,
  // so the deep-link-back after login never worked.)
  const redirectTo = searchParams.get("next") || searchParams.get("redirect") || "/"
  const callbackError = searchParams.get("error")

  useEffect(() => {
    if (state?.error) {
      toast.error(state.error)
    }
  }, [state])

  useEffect(() => {
    // Surface auth-callback / confirm failures (expired/used recovery or
    // confirm links) that redirect here with ?error=… — otherwise the user
    // sees nothing. `auth_callback_failed` comes from the PKCE /auth/callback
    // route; `link_expired` comes from the token-hash /auth/confirm route.
    if (callbackError) {
      const knownErrors: Record<string, string> = {
        auth_callback_failed: "登入連結已失效或已使用，請重新登入或重新寄送連結",
        link_expired: "確認連結已失效或已使用，請重新登入或重新寄送連結",
      }
      toast.error(knownErrors[callbackError] ?? decodeURIComponent(callbackError))
    }
  }, [callbackError])

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center flex flex-col items-center">
          <Image src="/logo.svg" alt="誠真生活" width={150} height={75} />
        </div>

        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl" style={{ color: "#10305a" }}>登入</CardTitle>
            <CardDescription>輸入您的帳號資訊以繼續</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={formAction} onSubmit={onSubmit} className="space-y-4">
                <input type="hidden" name="redirectTo" value={redirectTo} />
              <div className="space-y-2">
                <Label htmlFor="email">電子郵件</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">密碼</Label>
                  <Link
                    href="/auth/forgot-password"
                    className="text-xs hover:underline"
                    style={{ color: "#10305a" }}
                  >
                    忘記密碼？
                  </Link>
                </div>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="rememberMe"
                  name="rememberMe"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => toggleRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-input accent-[#10305a] cursor-pointer"
                />
                <Label htmlFor="rememberMe" className="text-sm font-normal cursor-pointer">
                  記住帳號密碼，下次自動帶入
                </Label>
              </div>
              {state?.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}
              <Button type="submit" className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }} disabled={isPending}>
                {isPending ? "登入中…" : "登入"}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center">
            <p className="text-sm text-muted-foreground">
              還沒有帳號？{" "}
              <Link
                href="/auth/register"
                className="font-medium hover:underline"
                style={{ color: "#10305a" }}
              >
                立即註冊
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
