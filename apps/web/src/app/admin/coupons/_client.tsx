"use client"

import { useState, useTransition, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createCouponAction } from "./actions"

interface MembershipTier {
  id: string
  name: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

export function CreateCouponForm() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [tiers, setTiers] = useState<MembershipTier[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchTiers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/membership-tiers`)
      if (res.ok) {
        const json = await res.json()
        setTiers(json.data ?? json.tiers ?? json ?? [])
      }
    } catch {
      /* API unavailable */
    }
  }, [])

  useEffect(() => {
    // Lazy-load tiers when the form opens. fetchTiers only setState()s AFTER an
    // await (not synchronously in the effect body), so this is a safe data-fetch
    // effect — the rule over-flags the indirect call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) fetchTiers()
  }, [open, fetchTiers])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setError(null)

    // <input type="date"> yields "YYYY-MM-DD"; the API requires a full ISO
    // datetime (z.string().datetime()). Send end-of-day in the admin's local
    // tz so the coupon stays valid through the whole expiry day.
    const expiresStr = (fd.get("expires_at") as string) || ""
    const expiresAt = expiresStr
      ? new Date(`${expiresStr}T23:59:59`).toISOString()
      : null

    startTransition(async () => {
      const result = await createCouponAction({
        code: fd.get("code") as string,
        type: fd.get("type") as string,
        value: Number(fd.get("value")),
        max_uses: fd.get("max_uses") ? Number(fd.get("max_uses")) : null,
        expires_at: expiresAt,
        tier_id: (fd.get("tier_id") as string) || null,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      form.reset()
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        新增折扣碼
      </Button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border rounded-lg bg-white p-4 space-y-4"
    >
      <h3 className="text-sm font-semibold">新增折扣碼</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="code" className="text-xs">折扣碼</Label>
          <Input id="code" name="code" placeholder="例如 SUMMER2026" required className="uppercase" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="type" className="text-xs">類型</Label>
          <select
            id="type"
            name="type"
            required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="percentage">百分比折扣</option>
            <option value="fixed">固定折扣</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="value" className="text-xs">折扣值</Label>
          <Input id="value" name="value" type="number" min={0} placeholder="10" required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="max_uses" className="text-xs">使用上限（空白=無限）</Label>
          <Input id="max_uses" name="max_uses" type="number" min={1} placeholder="不限" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="expires_at" className="text-xs">到期日</Label>
          <Input id="expires_at" name="expires_at" type="date" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tier_id" className="text-xs">限定等級</Label>
          <select
            id="tier_id"
            name="tier_id"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">全部等級</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          建立失敗：{error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "建立中…" : "建立"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
          取消
        </Button>
      </div>
    </form>
  )
}
