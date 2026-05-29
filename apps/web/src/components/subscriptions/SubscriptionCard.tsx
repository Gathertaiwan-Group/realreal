"use client"
import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "sonner"

type Sub = {
  id: string
  status: "active" | "paused" | "cancelled" | "past_due"
  next_billing_date: string | null
  retry_count: number
  subscription_plans: { name: string; price: string; interval: string }
}

const statusLabel: Record<Sub["status"], string> = {
  active: "訂閱中",
  paused: "已暫停",
  cancelled: "已取消",
  past_due: "逾期未付",
}
const statusVariant: Record<Sub["status"], "default" | "secondary" | "destructive"> = {
  active: "default",
  paused: "secondary",
  cancelled: "secondary",
  past_due: "destructive",
}

export function SubscriptionCard({ sub, onAction }: { sub: Sub; onAction: () => void }) {
  const [loading, setLoading] = useState(false)
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

  const actionLabels: Record<string, string> = {
    pause: "訂閱已暫停",
    resume: "訂閱已恢復",
    cancel: "訂閱已取消",
  }

  async function handleAction(action: "pause" | "resume" | "cancel") {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ action }),
      })
      if (res.ok) {
        toast.success(actionLabels[action])
      } else {
        toast.error("操作失敗，請稍後再試")
      }
    } catch {
      toast.error("操作失敗，請稍後再試")
    }
    setLoading(false)
    onAction()
  }

  return (
    <Card className="rounded-[10px] border-zinc-200">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base text-[#10305a]">{sub.subscription_plans.name}</CardTitle>
          <Badge variant={statusVariant[sub.status]}>{statusLabel[sub.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-600">
          NT${Number(sub.subscription_plans.price).toLocaleString()} / {sub.subscription_plans.interval === "monthly" ? "月" : "雙月"}
        </p>
        {sub.next_billing_date && (
          <p className="text-sm text-zinc-500">下次扣款：{sub.next_billing_date}</p>
        )}
        {sub.retry_count > 0 && (
          <p className="text-sm text-red-600">已失敗 {sub.retry_count} 次</p>
        )}
        <div className="flex gap-2 pt-1">
          {sub.status === "active" && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-[10px]"
              onClick={() => handleAction("pause")}
              disabled={loading}
            >
              暫停
            </Button>
          )}
          {sub.status === "paused" && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-[10px] border-[#10305a] text-[#10305a] hover:bg-[#10305a] hover:text-white"
              onClick={() => handleAction("resume")}
              disabled={loading}
            >
              恢復
            </Button>
          )}
          {sub.status !== "cancelled" && (
            <Button
              variant="destructive"
              size="sm"
              className="rounded-[10px]"
              onClick={() => handleAction("cancel")}
              disabled={loading}
            >
              取消
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
