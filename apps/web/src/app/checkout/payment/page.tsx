"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { API_URL } from "@/lib/api-url"
import type { InvoiceData } from "@/components/checkout/InvoiceSelector"

type PaymentMethod = "pchomepay" | "linepay" | "jkopay"

type PaymentOption = {
  value: PaymentMethod
  label: string
  icon: string
  color: string
  note?: string
}

const PAYMENT_OPTIONS: PaymentOption[] = [
  { value: "pchomepay", label: "PChomePay 支付連", icon: "💳", color: "bg-blue-50 border-blue-200" },
  { value: "linepay", label: "LINE Pay", icon: "💚", color: "bg-green-50 border-green-200", note: "不支援定期訂閱扣款" },
  { value: "jkopay", label: "街口支付 JKOPay", icon: "🟠", color: "bg-orange-50 border-orange-200", note: "不支援定期訂閱扣款" },
]

type CheckoutData = {
  items: { variantId: string; productName: string; variantName: string; price: number; qty: number }[]
  address: { name: string; phone: string; email?: string; addressType: string; city: string; district?: string; postalCode: string; addressLine?: string; cvsStoreName?: string; cvsStoreId?: string }
  shippingMethod: string
  shippingFee?: number
  invoice?: InvoiceData
}

const SHIPPING_LABELS: Record<string, string> = {
  "711": "7-11取貨",
  "family": "全家取貨",
  "home_delivery": "宅配",
}

const STEPS = [
  { num: 1, label: "收件資訊" },
  { num: 2, label: "付款方式" },
  { num: 3, label: "確認訂單" },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <nav className="mb-8" aria-label="結帳步驟">
      <ol className="flex items-center justify-center gap-0">
        {STEPS.map((step, i) => {
          const isActive = step.num === current
          const isCompleted = step.num < current
          return (
            <li key={step.num} className="flex items-center">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                    isActive
                      ? "text-white"
                      : isCompleted
                        ? "text-white/90"
                        : "bg-zinc-100 text-zinc-400"
                  }`}
                  style={isActive ? { backgroundColor: "#10305a" } : isCompleted ? { backgroundColor: "#10305a", opacity: 0.6 } : undefined}
                >
                  {isCompleted ? "✓" : step.num}
                </span>
                <span
                  className={`text-sm font-medium ${
                    isActive ? "text-foreground" : "text-zinc-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-3 h-px w-8 sm:w-12 ${
                    isCompleted ? "" : "bg-zinc-200"
                  }`}
                  style={isCompleted ? { backgroundColor: "rgba(16,48,90,0.4)" } : undefined}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default function PaymentPage() {
  const router = useRouter()
  const [checkoutData, setCheckoutData] = useState<CheckoutData | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pchomepay")
  const [couponCode, setCouponCode] = useState("")
  const [couponApplied, setCouponApplied] = useState(false)
  const [couponError, setCouponError] = useState("")
  const [discount, setDiscount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [memberDiscount, setMemberDiscount] = useState<{ discountRate: number; tierName: string | null }>({ discountRate: 0, tierName: null })

  // Points redemption state
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [pointsBalance, setPointsBalance] = useState(0)
  const [pointsInput, setPointsInput] = useState<string>("")
  const [pointsUsed, setPointsUsed] = useState(0)
  const [pointsDiscount, setPointsDiscount] = useState(0)
  const [pointsAllowed, setPointsAllowed] = useState(true)
  const [pointsReason, setPointsReason] = useState<string>("")
  const [pointsRatio, setPointsRatio] = useState(1)
  const [allowCouponStack, setAllowCouponStack] = useState(true)
  const [pointsApplying, setPointsApplying] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem("realreal-checkout")
    if (!raw) {
      router.replace("/checkout")
      return
    }
    try {
      setCheckoutData(JSON.parse(raw) as CheckoutData)
    } catch {
      router.replace("/checkout")
    }
  }, [router])

  // Fetch member discount rate for logged-in users
  useEffect(() => {
    async function fetchMemberDiscount() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        const res = await fetch(`${API_URL}/my-member-discount`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const body = await res.json() as { data?: { discountRate?: number; tierName?: string | null } }
        if (body?.data?.discountRate && body.data.discountRate > 0) {
          setMemberDiscount({ discountRate: body.data.discountRate, tierName: body.data.tierName ?? null })
        }
      } catch {
        // Silently fail — member discount is optional
      }
    }
    fetchMemberDiscount()
  }, [])

  // Fetch points balance + settings (logged-in users only)
  useEffect(() => {
    async function fetchPointsBalance() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return

        setIsLoggedIn(true)
        const res = await fetch(`${API_URL}/points/balance`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok) return
        const body = await res.json() as {
          data?: {
            balance?: number
            ratio?: number
            allow_coupon_stack?: boolean
          }
        }
        const balance = body?.data?.balance ?? 0
        setPointsBalance(Math.max(0, balance))
        if (typeof body?.data?.ratio === "number") setPointsRatio(body.data.ratio)
        if (typeof body?.data?.allow_coupon_stack === "boolean") {
          setAllowCouponStack(body.data.allow_coupon_stack)
        }
      } catch {
        // Silently fail — points are optional
      }
    }
    fetchPointsBalance()
  }, [])

  const subtotal = checkoutData
    ? checkoutData.items.reduce((sum, i) => sum + i.price * i.qty, 0)
    : 0
  const shippingFee = checkoutData?.shippingFee ?? 0
  const memberDiscountAmount = Math.round(subtotal * memberDiscount.discountRate)
  const grandTotal = Math.max(0, subtotal - memberDiscountAmount + shippingFee - discount - pointsDiscount)

  // Determine if points input is blocked by coupon stacking rule
  const pointsBlockedByCoupon = couponApplied && !allowCouponStack
  const pointsBlockReason = pointsBlockedByCoupon ? "已使用優惠券，無法同時用點數" : ""

  // Debounced apply: POST /points/apply on input change
  useEffect(() => {
    if (!checkoutData) return
    if (pointsBalance === 0) return
    if (pointsBlockedByCoupon) {
      setPointsUsed(0)
      setPointsDiscount(0)
      setPointsAllowed(true)
      setPointsReason("")
      return
    }
    const requested = Number.parseInt(pointsInput, 10)
    if (!Number.isFinite(requested) || requested <= 0) {
      setPointsUsed(0)
      setPointsDiscount(0)
      setPointsAllowed(true)
      setPointsReason("")
      return
    }
    const handle = setTimeout(async () => {
      setPointsApplying(true)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        }
        const cart = {
          subtotal,
          shipping: shippingFee,
          total: subtotal + shippingFee,
          sale_item_total: 0,
        }
        const res = await fetch(`${API_URL}/points/apply`, {
          method: "POST",
          headers,
          body: JSON.stringify({ requested, cart }),
        })
        if (!res.ok) {
          setPointsAllowed(false)
          setPointsReason("無法套用點數")
          setPointsUsed(0)
          setPointsDiscount(0)
          return
        }
        const body = await res.json() as {
          data?: { discount?: number; allowed?: boolean; reason?: string }
        }
        const allowed = body?.data?.allowed ?? false
        const d = body?.data?.discount ?? 0
        const reason = body?.data?.reason ?? ""
        setPointsAllowed(allowed)
        setPointsReason(reason)
        if (allowed) {
          setPointsUsed(requested)
          setPointsDiscount(d)
        } else {
          setPointsUsed(0)
          setPointsDiscount(0)
        }
      } catch {
        setPointsAllowed(false)
        setPointsReason("套用點數時發生錯誤")
        setPointsUsed(0)
        setPointsDiscount(0)
      } finally {
        setPointsApplying(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [pointsInput, pointsBalance, pointsBlockedByCoupon, checkoutData, subtotal, shippingFee, couponApplied, allowCouponStack, pointsAllowed])

  const [couponLoading, setCouponLoading] = useState(false)

  async function handleApplyCoupon() {
    setCouponError("")
    if (!couponCode.trim()) {
      setCouponError("請輸入優惠碼")
      return
    }
    setCouponLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const couponHeaders: Record<string, string> = { "Content-Type": "application/json" }
      if (session?.access_token) couponHeaders.Authorization = `Bearer ${session.access_token}`
      const res = await fetch(`${API_URL}/coupons/validate`, {
        method: "POST",
        headers: couponHeaders,
        body: JSON.stringify({ code: couponCode.trim(), order_amount: subtotal }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "無效的優惠碼" }))
        setCouponError((body as { error?: string }).error ?? "無效的優惠碼")
        setCouponApplied(false)
        setDiscount(0)
        return
      }
      const body = await res.json() as { data?: { discount?: number } }
      const discountAmount = body?.data?.discount ?? 0
      setDiscount(discountAmount)
      setCouponApplied(true)
    } catch {
      setCouponError("驗證優惠碼時發生錯誤，請稍後再試")
      setCouponApplied(false)
      setDiscount(0)
    } finally {
      setCouponLoading(false)
    }
  }

  async function handleConfirm() {
    if (!checkoutData) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`
      }
      // Normalize cart items and address to the shapes the API zod schema
      // requires (it doesn't know about productName / variantName / addressLine
      // / 711-or-family shipping shorthand the cart UI uses).
      const apiItems = checkoutData.items.map((i) => ({
        variantId: i.variantId,
        qty: i.qty,
        unitPrice: Math.round(i.price * 100),
        productName: i.productName,
        variantName: i.variantName,
      }))
      const shippingMethodMap: Record<string, string> = {
        "711": "cvs_711",
        family: "cvs_family",
        home_delivery: "home_delivery",
      }
      const shippingMethod =
        shippingMethodMap[checkoutData.shippingMethod] ?? checkoutData.shippingMethod
      const cvsTypeMap: Record<string, string> = { cvs_711: "711", cvs_family: "family" }
      const apiAddress = {
        type: "shipping",
        name: checkoutData.address.name,
        phone: checkoutData.address.phone,
        addressType: shippingMethod === "home_delivery" ? "home" : "cvs",
        address:
          checkoutData.address.addressLine ||
          checkoutData.address.cvsStoreName ||
          undefined,
        city: checkoutData.address.city || undefined,
        postalCode: checkoutData.address.postalCode || undefined,
        cvsStoreId: checkoutData.address.cvsStoreId || undefined,
        cvsType: cvsTypeMap[shippingMethod],
      }
      const res = await fetch(`${API_URL}/orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          items: apiItems,
          address: apiAddress,
          shippingMethod,
          paymentMethod,
          invoice: checkoutData.invoice,
          guestEmail: session ? undefined : checkoutData.address.email,
          couponCode: couponApplied ? couponCode : undefined,
          points_used: pointsUsed > 0 && pointsAllowed ? pointsUsed : 0,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "建立訂單失敗" }))
        throw new Error((body as { message?: string }).message ?? "建立訂單失敗")
      }

      const data = await res.json() as {
        data?: { orderId?: string; orderNumber?: string; paymentUrl?: string }
      }
      const paymentUrl = data?.data?.paymentUrl

      if (paymentUrl) {
        // Redirect to payment gateway (PChomePay / LINE Pay / JKOPay).
        // Cart clearing and confirm redirect happen after the payment webhook callback.
        toast.success("正在前往付款頁面...")
        window.location.href = paymentUrl
      } else {
        // paymentUrl should always be present; if missing, show an error
        setError("無法取得付款連結，請稍後再試或聯繫客服")
      }
    } catch (err) {
      toast.error("建立訂單失敗")
      setError(err instanceof Error ? err.message : "付款失敗，請稍後再試")
    } finally {
      setLoading(false)
    }
  }

  if (!checkoutData) return null

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <StepIndicator current={2} />

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-8">
          <h1 className="text-2xl font-bold">選擇付款方式</h1>

          {/* Shipping Info Summary */}
          <section className="rounded-lg border bg-zinc-50/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-sm text-zinc-500">收件資訊</h2>
              <Link href="/checkout" className="text-xs text-primary hover:underline">修改</Link>
            </div>
            <div className="text-sm space-y-0.5">
              <p><span className="text-zinc-500 inline-block w-16">收件人</span>{checkoutData.address.name}</p>
              <p><span className="text-zinc-500 inline-block w-16">電話</span>{checkoutData.address.phone}</p>
              <p>
                <span className="text-zinc-500 inline-block w-16">配送</span>
                {SHIPPING_LABELS[checkoutData.shippingMethod] ?? checkoutData.shippingMethod}
                {checkoutData.address.cvsStoreName && ` - ${checkoutData.address.cvsStoreName}`}
              </p>
              {checkoutData.address.addressLine && (
                <p><span className="text-zinc-500 inline-block w-16">地址</span>{checkoutData.address.city}{checkoutData.address.district}{checkoutData.address.addressLine}</p>
              )}
            </div>
          </section>

          {/* Coupon Code */}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold border-b pb-2">優惠碼</h2>
            <div className="flex gap-2">
              <Input
                placeholder="輸入優惠碼"
                value={couponCode}
                onChange={e => { setCouponCode(e.target.value) }}
                disabled={couponApplied}
                className="max-w-xs"
              />
              {couponApplied ? (
                <Button
                  variant="outline"
                  onClick={() => { setCouponCode(""); setCouponApplied(false); setDiscount(0) }}
                >
                  移除
                </Button>
              ) : (
                <Button variant="outline" onClick={handleApplyCoupon} disabled={couponLoading}>
                  {couponLoading ? "驗證中..." : "套用"}
                </Button>
              )}
            </div>
            {couponApplied && (
              <p className="text-sm text-green-600">已套用優惠碼，折抵 NT$ {discount.toLocaleString()}</p>
            )}
            {couponError && (
              <p className="text-sm text-red-500">{couponError}</p>
            )}
          </section>

          {/* Points Redemption — shown for all logged-in users to build awareness */}
          {isLoggedIn && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold border-b pb-2">公益點折抵</h2>
              <p className="text-sm text-zinc-600">
                你目前有 <span className="font-semibold">{pointsBalance.toLocaleString()}</span> 點
                {pointsBalance > 0 && `（= NT$ ${Math.floor(pointsBalance * pointsRatio).toLocaleString()}）`}
              </p>
              {pointsBalance === 0 ? (
                <p className="text-sm text-zinc-400">累積消費可獲得公益點，下次購物可折抵金額。</p>
              ) : (
                <div className="flex gap-2 items-center">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={pointsBalance}
                    placeholder="使用點數"
                    value={pointsInput}
                    onChange={e => {
                      const raw = e.target.value
                      if (raw === "") {
                        setPointsInput("")
                        return
                      }
                      const n = Number.parseInt(raw, 10)
                      if (!Number.isFinite(n)) {
                        setPointsInput("")
                        return
                      }
                      const clamped = Math.max(0, Math.min(pointsBalance, n))
                      setPointsInput(String(clamped))
                    }}
                    disabled={pointsBlockedByCoupon}
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPointsInput(String(pointsBalance))}
                    disabled={pointsBlockedByCoupon}
                  >
                    全部使用
                  </Button>
                  <span className="text-sm text-zinc-500">點</span>
                </div>
              )}
              {pointsBlockReason && (
                <p className="text-sm text-zinc-500">{pointsBlockReason}</p>
              )}
              {!pointsBlockedByCoupon && pointsApplying && (
                <p className="text-sm text-zinc-400">計算中…</p>
              )}
              {!pointsBlockedByCoupon && !pointsApplying && pointsInput !== "" && Number.parseInt(pointsInput, 10) > 0 && (
                pointsAllowed ? (
                  <p className="text-sm text-green-600">已折抵 -NT$ {pointsDiscount.toLocaleString()}</p>
                ) : (
                  <p className="text-sm text-red-500">{pointsReason || "無法套用"}</p>
                )
              )}
            </section>
          )}

          {/* Payment Method Cards */}
          <section className="space-y-4">
            <h2 className="text-lg font-semibold border-b pb-2">付款方式</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {PAYMENT_OPTIONS.map(option => {
                const selected = paymentMethod === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPaymentMethod(option.value)}
                    className={`relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-all ${
                      selected
                        ? "shadow-sm"
                        : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50"
                    }`}
                    style={selected ? { borderColor: "#10305a", backgroundColor: "rgba(16,48,90,0.05)" } : undefined}
                  >
                    {selected && (
                      <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full text-white text-xs" style={{ backgroundColor: "#10305a" }}>
                        ✓
                      </span>
                    )}
                    <span className="text-2xl">{option.icon}</span>
                    <span className="font-medium text-sm">{option.label}</span>
                    {option.note && (
                      <span className="text-[11px] text-zinc-400 leading-tight">{option.note}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Mobile Order Total */}
          <div className="lg:hidden rounded-lg border bg-zinc-50/50 p-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-500">
                <span>商品小計</span>
                <span>NT$ {subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>運費</span>
                <span>NT$ {shippingFee.toLocaleString()}</span>
              </div>
              {memberDiscountAmount > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>{memberDiscount.tierName ?? "會員"}折扣 ({Math.round(memberDiscount.discountRate * 100)}% off)</span>
                  <span>-NT$ {memberDiscountAmount.toLocaleString()}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>優惠折抵</span>
                  <span>-NT$ {discount.toLocaleString()}</span>
                </div>
              )}
              {pointsDiscount > 0 && pointsAllowed && (
                <div className="flex justify-between text-green-600">
                  <span>公益點折抵 ({pointsUsed.toLocaleString()} 點)</span>
                  <span>-NT$ {pointsDiscount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>合計</span>
                <span style={{ color: "#10305a" }}>NT$ {grandTotal.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Link href="/checkout">
              <Button variant="outline" className="w-full sm:w-auto">
                ← 返回上一步
              </Button>
            </Link>
            <Button
              className="flex-1 rounded-[10px]"
              style={{ backgroundColor: "#10305a", color: "#fff" }}
              onClick={handleConfirm}
              disabled={loading || pointsApplying}
            >
              {loading ? "處理中..." : `確認付款 NT$ ${grandTotal.toLocaleString()}`}
            </Button>
          </div>
        </div>

        {/* Desktop Order Summary Sidebar */}
        <aside className="hidden lg:block w-80 shrink-0">
          <div className="sticky top-8 rounded-lg border bg-zinc-50/50 p-5 space-y-4">
            <h2 className="font-semibold text-lg">訂單摘要</h2>
            <div className="divide-y">
              {checkoutData.items.map(item => (
                <div key={item.variantId} className="flex justify-between py-2.5 text-sm">
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="font-medium truncate">{item.productName}</p>
                    <p className="text-xs text-zinc-500">{item.variantName} x {item.qty}</p>
                  </div>
                  <p className="font-medium whitespace-nowrap">NT$ {(item.price * item.qty).toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="border-t pt-3 space-y-2 text-sm">
              <div className="flex justify-between text-zinc-500">
                <span>商品小計</span>
                <span>NT$ {subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>運費</span>
                <span>NT$ {shippingFee.toLocaleString()}</span>
              </div>
              {memberDiscountAmount > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>{memberDiscount.tierName ?? "會員"}折扣 ({Math.round(memberDiscount.discountRate * 100)}% off)</span>
                  <span>-NT$ {memberDiscountAmount.toLocaleString()}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>優惠折抵</span>
                  <span>-NT$ {discount.toLocaleString()}</span>
                </div>
              )}
              {pointsDiscount > 0 && pointsAllowed && (
                <div className="flex justify-between text-green-600">
                  <span>公益點折抵 ({pointsUsed.toLocaleString()} 點)</span>
                  <span>-NT$ {pointsDiscount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>合計</span>
                <span style={{ color: "#10305a" }}>NT$ {grandTotal.toLocaleString()}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
