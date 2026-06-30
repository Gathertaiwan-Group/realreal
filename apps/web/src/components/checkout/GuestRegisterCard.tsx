"use client"

/**
 * Post-checkout guest → member conversion card.
 *
 * Rendered on /checkout/confirm when:
 *   - the order completed successfully (or is cvs_cod), AND
 *   - the order is a guest order (guest_email is non-null and user_id is null
 *     per the public status endpoint's conditional response), AND
 *   - the visitor is not already logged in.
 *
 * Flow:
 *   1. Default: collapsed CTA with two buttons (建立帳號 / 稍後再說).
 *   2. Expanded: email (disabled prefill) + password + optional display name.
 *   3. Submit → POST /auth/legacy/register-from-guest → on success,
 *      signInWithPassword to establish a session in-place, then flip to
 *      "✓ 帳戶已建立" state with a link to /my-account/orders.
 *
 * No verification email is sent (`email_confirm: true` on the backend).
 */

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

type Props = {
  email: string
  orderNumber: string
}

type Phase = "cta" | "form" | "done" | "dismissed"

export function GuestRegisterCard({ email, orderNumber }: Props) {
  const [phase, setPhase] = useState<Phase>("cta")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    if (password.length < 8) {
      toast.error("密碼至少 8 個字元")
      return
    }
    setSubmitting(true)
    try {
      const r = await fetch(`${API_URL}/auth/legacy/register-from-guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          displayName: displayName.trim() || undefined,
          orderNumber,
        }),
      })
      const body = (await r.json().catch(() => ({}))) as {
        userId?: string
        claimedOrderCount?: number
        error?: string
      }
      if (!r.ok) {
        if (body.error === "email_already_registered") {
          toast.error("此 email 已是會員，請改用登入", {
            action: { label: "前往登入", onClick: () => { window.location.href = "/auth/login" } },
          })
        } else {
          toast.error(body.error ?? "建立帳號失敗，請稍後再試")
        }
        setSubmitting(false)
        return
      }

      // Immediately establish a session in the browser so the user can
      // navigate straight to /my-account without going through /auth/login.
      const supabase = createClient()
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) {
        // Account created but auto-login failed — they can still log in manually.
        toast.warning("帳號已建立，請至登入頁登入")
        setPhase("done")
        setSubmitting(false)
        return
      }
      setPhase("done")
      setSubmitting(false)
    } catch (err) {
      toast.error("建立帳號失敗，請稍後再試")
      setSubmitting(false)
      console.error("[GuestRegisterCard] submit threw:", err)
    }
  }

  if (phase === "dismissed") return null

  if (phase === "done") {
    return (
      <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/50 p-5 text-left space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">✓</span>
          <p className="font-semibold text-emerald-900">帳戶已建立！</p>
        </div>
        <p className="text-sm text-emerald-800">
          已將這筆訂單以及您過去用 <span className="font-mono">{email}</span> 下的訂單，全部歸入您的帳戶。
        </p>
        <Link href="/my-account/orders" className="block">
          <Button className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }}>
            查看我的訂單 →
          </Button>
        </Link>
      </div>
    )
  }

  if (phase === "cta") {
    return (
      <div className="rounded-lg border bg-white p-5 text-left space-y-3">
        <p className="font-semibold" style={{ color: "#10305a" }}>儲存到會員帳號？</p>
        <p className="text-sm text-zinc-600 leading-relaxed">
          建立會員帳號 — 輕鬆查訂單、累積公益點數、下次更快結帳。
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => setPhase("form")}
            className="flex-1 rounded-[10px]"
            style={{ backgroundColor: "#10305a", color: "#fff" }}
          >
            建立帳號
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setPhase("dismissed")}
            className="text-zinc-500"
          >
            稍後再說
          </Button>
        </div>
      </div>
    )
  }

  // phase === "form"
  return (
    <form onSubmit={onSubmit} className="rounded-lg border-2 border-[#10305a]/20 bg-white p-5 text-left space-y-4">
      <div>
        <p className="font-semibold" style={{ color: "#10305a" }}>建立會員帳號</p>
        <p className="text-xs text-zinc-500 mt-1">下次到 realreal.cc 用同 email + 密碼即可登入查訂單。</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="guest-register-email">Email</Label>
        <Input
          id="guest-register-email"
          type="email"
          value={email}
          disabled
          autoComplete="email"
          className="bg-zinc-50"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="guest-register-password">設定密碼（至少 8 字元）</Label>
        <Input
          id="guest-register-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="guest-register-name" className="font-normal">
          暱稱 <span className="text-xs text-zinc-400">（選填）</span>
        </Label>
        <Input
          id="guest-register-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={100}
          placeholder={email.split("@")[0]}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-[10px]"
          style={{ backgroundColor: "#10305a", color: "#fff" }}
        >
          {submitting ? "建立中…" : "建立帳號"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setPhase("dismissed")}
          disabled={submitting}
          className="text-zinc-500"
        >
          取消
        </Button>
      </div>
    </form>
  )
}
