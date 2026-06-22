"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { API_URL } from "@/lib/api-url"

// Members may self-cancel only BEFORE shipping. Mirror the server gate
// (apps/api orders.ts MEMBER_CANCELLABLE) so the button never shows for orders
// the API would reject anyway.
const CANCELLABLE = new Set(["pending", "processing"])
const REASONS = ["改變心意", "下錯商品", "重複下單", "其他"]

export function CancelOrderButton({
  orderId,
  status,
  paymentStatus,
}: {
  orderId: string
  status: string
  paymentStatus: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  if (!CANCELLABLE.has(status)) return null

  function submit() {
    startTransition(async () => {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const res = await fetch(`${API_URL}/orders/${orderId}/cancel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify(reason ? { reason } : {}),
        })
        const json = (await res.json().catch(() => ({}))) as {
          error?: string
          refunded?: boolean
        }
        if (!res.ok) {
          toast.error(json?.error ?? "取消失敗，請稍後再試")
          return
        }
        toast.success(
          json?.refunded
            ? "訂單已取消，退款將由專人手動處理（約 3–7 個工作天）"
            : "訂單已取消",
        )
        setOpen(false)
        router.refresh()
      } catch {
        toast.error("取消失敗，請稍後再試")
      }
    })
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
        onClick={() => setOpen(true)}
      >
        取消訂單
      </Button>
    )
  }

  const isPaid = paymentStatus === "paid"
  return (
    <div className="w-full rounded-lg border border-red-200 bg-red-50/60 p-4 text-sm">
      <p className="mb-1 font-medium text-red-700">確認取消這筆訂單？</p>
      <p className="mb-3 text-zinc-600">
        取消後庫存與已折抵的點數、優惠券會自動退回。
        {isPaid && "此訂單已付款，退款將由專人手動處理（約 3–7 個工作天）。"}
      </p>

      <div className="mb-3">
        <Label className="text-xs text-zinc-500">取消原因（選填）</Label>
        <RadioGroup
          value={reason}
          onValueChange={setReason}
          className="mt-1.5 grid grid-cols-2 gap-1.5"
        >
          {REASONS.map((r) => (
            <label key={r} htmlFor={`cancel-reason-${r}`} className="flex cursor-pointer items-center gap-2">
              <RadioGroupItem value={r} id={`cancel-reason-${r}`} />
              <span>{r}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      <div className="flex gap-2">
        <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={submit}>
          {pending ? "取消中…" : "確認取消"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
          返回
        </Button>
      </div>
    </div>
  )
}
