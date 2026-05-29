"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

interface Plan {
  id: string
  name: string
  interval: string
  price: string
  benefits: { label: string }[] | null
}

export default function SubscribeConfirmPage() {
  const { planId } = useParams<{ planId: string }>()
  const router = useRouter()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubscribing, setIsSubscribing] = useState(false)
  const [error, setError] = useState("")

  const handleSubscribeWithToken = useCallback(
    async (token: string) => {
      setIsSubscribing(true)
      setError("")
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${API_URL}/subscriptions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token ?? ""}`,
          },
          body: JSON.stringify({ planId, paymentToken: token }),
        })
        if (!res.ok) throw new Error("subscribe failed")
        toast.success("訂閱成功！")
        router.push("/my-account/subscriptions")
      } catch {
        setError("訂閱建立失敗，請再試一次")
        setIsSubscribing(false)
      }
    },
    [planId, router]
  )

  // Fetch plan details from API
  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch(`${API_URL}/subscription-plans/${planId}`)
        if (!res.ok) throw new Error("not found")
        const json = await res.json()
        setPlan(json.data ?? json)
      } catch {
        setError("找不到此方案")
      }
      setIsLoading(false)
    }
    fetchPlan()
  }, [planId])

  // Handle return from PChomePay: ?pchomepay_token= param -> call POST /subscriptions
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get("pchomepay_token")
    if (token && planId) {
      handleSubscribeWithToken(token)
    }
  }, [planId, handleSubscribeWithToken])

  function handleRegisterToken() {
    if (!plan) return
    const returnUrl = encodeURIComponent(`${window.location.origin}/subscribe/${planId}`)
    const registrationUrl =
      `https://payment.pchomepay.com.tw/api/token/register` +
      `?MerchantID=${process.env.NEXT_PUBLIC_PCHOMEPAY_MERCHANT_ID ?? ""}` +
      `&ReturnURL=${returnUrl}` +
      `&MerchantOrderNo=TOKREG_${planId}` +
      `&TokenTerm=RealReal_recurring`
    window.location.href = registrationUrl
  }

  if (isLoading) return <div className="flex justify-center py-20 text-zinc-500">載入中…</div>
  if (!plan && error) return <div className="flex justify-center py-20 text-red-600">{error}</div>
  if (!plan) return null

  const intervalLabel = plan.interval === "bimonthly" ? "每兩個月" : "每個月"

  return (
    <div className="container mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold text-[#10305a] mb-6">確認訂閱</h1>

      <Card className="mb-6 rounded-[10px] border-zinc-200">
        <CardHeader>
          <CardTitle className="text-[#10305a]">{plan.name}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center">
            <span className="text-zinc-500">訂閱週期</span>
            <span>{intervalLabel}自動扣款</span>
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-zinc-500">每期金額</span>
            <span className="text-xl font-bold text-[#10305a]">NT${Number(plan.price).toLocaleString()}</span>
          </div>
          {plan.benefits && Array.isArray(plan.benefits) && plan.benefits.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-100">
              <p className="text-sm font-medium text-zinc-700 mb-2">方案內容</p>
              <ul className="space-y-1 text-sm text-zinc-600">
                {plan.benefits.map((b, i) => (
                  <li key={b.label ?? i} className="flex items-start gap-1.5">
                    <span className="text-[#10305a] mt-0.5">✓</span>
                    <span>{b.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-zinc-400 mt-4">
            訂閱後將以 PChomePay 綁定信用卡自動扣款。您可隨時在帳戶中暫停或取消訂閱。
          </p>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-4 rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Button
        className="w-full rounded-[10px] bg-[#10305a] hover:bg-[#1a4070]"
        size="lg"
        onClick={handleRegisterToken}
        disabled={isSubscribing}
      >
        {isSubscribing ? "處理中…" : "以 PChomePay 設定定期扣款"}
      </Button>

      <p className="text-center text-xs text-zinc-400 mt-4">
        系統採用 PChomePay Token 加密儲存，我們不直接儲存您的卡號。
      </p>
    </div>
  )
}
