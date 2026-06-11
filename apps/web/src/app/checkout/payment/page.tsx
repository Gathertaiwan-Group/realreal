"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { API_URL } from "@/lib/api-url"
import type { InvoiceData } from "@/components/checkout/InvoiceSelector"
import {
  buildOrderPreviewItems,
  formatShippingPreviewLabel,
  toApiShippingMethod,
  type CheckoutShippingMethod,
} from "@/lib/shipping-preview"
import {
  readPromoState,
  clearPromoState,
  PROMO_EVENT,
  type PromoState,
} from "@/components/checkout/PromoWidget"

type PaymentMethod = "pchomepay" | "linepay" | "jkopay" | "cvs_cod" | "test_paid"

type PaymentOption = {
  value: PaymentMethod
  label: string
  icon: string
  color: string
  note?: string
}

type CheckoutData = {
  items: { variantId: string; productName: string; variantName: string; price: number; qty: number }[]
  address: {
    name: string; phone: string; email?: string; addressType: string;
    city: string; district?: string; postalCode: string; addressLine?: string;
    cvsStoreName?: string; cvsStoreId?: string;
    country?: string
  }
  shippingMethod: string
  shippingFee?: number
  invoice?: InvoiceData
  forcedPaymentMethod?: string
}

const SHIPPING_LABELS: Record<string, string> = {
  "711": "7-11取貨",
  "family": "全家取貨",
  "home_delivery": "宅配",
  "overseas_cod": "海外寄送（到付）",
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Idempotency-Key for POST /orders (Fix 4a). The API has idempotency
  // middleware that replays the cached response when the same key arrives
  // twice within its TTL — so a double-submit returns the SAME order instead
  // of creating a duplicate. We generate the key once per submit attempt and
  // reuse it on retries of that attempt (e.g. a network-timeout retry where the
  // server may already have created the order). It is rotated to null only when
  // the user changes an order-affecting input below, so a deliberately
  // different order isn't blocked by a stale cached response.
  const idempotencyKeyRef = useRef<string | null>(null)
  // Set once the submission has irreversibly handed off (redirect to gateway
  // or push to confirm). Keeps the button disabled even though the `finally`
  // resets `loading` — a re-enabled button after `window.location.href = ...`
  // would let an impatient user fire a second order during the redirect.
  const submittedRef = useRef(false)
  const [submitted, setSubmitted] = useState(false)

  // Promo state is now owned by step 1's PromoWidget; we just read it.
  // Listening to PROMO_EVENT lets the sidebar stay in sync if the user opens
  // a second tab and modifies the coupon there.
  const [promo, setPromo] = useState<PromoState | null>(null)
  useEffect(() => {
    setPromo(readPromoState())
    const handler = () => setPromo(readPromoState())
    window.addEventListener(PROMO_EVENT, handler)
    return () => window.removeEventListener(PROMO_EVENT, handler)
  }, [])

  // Admin detection — gates visibility of the "test_paid" sandbox payment
  // method (skips gateway but runs the full post-payment pipeline: invoice /
  // email / stock / points / LINE Notify). The server restricts test_paid to
  // role==="admin" (403 otherwise), so a normal customer must NOT see it.
  // Mirror the server check (orders.ts) + admin layout: read user_profiles.role
  // for the logged-in user and require "admin".
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("role")
          .eq("user_id", user.id)
          .maybeSingle()
        if (cancelled) return
        if ((profile as { role?: string | null } | null)?.role === "admin") {
          setIsAdmin(true)
        }
      } catch { /* guest / no profile → not admin */ }
    })()
    return () => { cancelled = true }
  }, [])

  const isCvsShipping = checkoutData?.shippingMethod === "711" || checkoutData?.shippingMethod === "family"
  const forcedPayment = checkoutData?.forcedPaymentMethod as PaymentMethod | undefined

  const PAYMENT_OPTIONS: PaymentOption[] = forcedPayment === "cvs_cod"
    ? [
        {
          value: "cvs_cod" as PaymentMethod,
          label: "超商取貨付款",
          icon: "🏪",
          color: "bg-zinc-50 border-zinc-200",
          note: "到店取貨時付款，由綠界代收",
        },
      ]
    : [
        { value: "pchomepay", label: "PChomePay 支付連", icon: "💳", color: "bg-blue-50 border-blue-200" },
        { value: "linepay", label: "LINE Pay", icon: "💚", color: "bg-green-50 border-green-200", note: "不支援定期訂閱扣款" },
        { value: "jkopay", label: "街口支付 JKOPay", icon: "🟠", color: "bg-orange-50 border-orange-200", note: "不支援定期訂閱扣款" },
        ...(isCvsShipping ? [{
          value: "cvs_cod" as PaymentMethod,
          label: "超商取貨付款",
          icon: "🏪",
          color: "bg-zinc-50 border-zinc-200",
          note: "到店取貨時付款，由綠界代收"
        }] : []),
        // Sandbox: skip gateway, run full pipeline (invoice / email / stock /
        // points / LINE Notify). Admin-only — the server rejects test_paid for
        // non-admins (403), so we hide it from normal customers entirely.
        ...(isAdmin ? [{
          value: "test_paid" as PaymentMethod,
          label: "🧪 沙盒測試付款",
          icon: "🧪",
          color: "bg-amber-50 border-amber-300",
          note: "不過金流但跑完整流程（發票/通知/庫存/點數）— 限管理員"
        }] : []),
      ]

  useEffect(() => {
    if (forcedPayment) {
      setPaymentMethod(forcedPayment)
    } else if (!isCvsShipping && paymentMethod === "cvs_cod") {
      setPaymentMethod("pchomepay")
    }
  }, [forcedPayment, isCvsShipping, paymentMethod])

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

  const subtotal = checkoutData
    ? checkoutData.items.reduce((sum, i) => sum + i.price * i.qty, 0)
    : 0

  // Derived from promo state — written by PromoWidget at step 1. We still read
  // these to (a) feed the server preview the applied coupon/points and (b)
  // label the breakdown lines. The displayed AMOUNTS come from the server
  // preview below, not from this client-side math.
  const couponCode = promo?.couponCode ?? ""
  const couponApplied = promo?.couponApplied ?? false
  const promoCouponDiscount = promo?.couponApplied ? promo.couponDiscount : 0
  const pointsUsed = promo?.pointsAllowed ? promo.pointsUsed : 0
  const promoPointsDiscount = promo?.pointsAllowed ? promo.pointsDiscount : 0
  const tierName = promo?.tierName ?? null
  const memberDiscountRate = promo?.memberDiscountRate ?? 0

  // Server-authoritative breakdown (Fix 2). Step 1 persisted only `shippingFee`
  // and omitted the campaign discount, and `shippingFee ?? 0` would silently
  // undercharge the display if step-1's preview had failed. So on this page we
  // re-call POST /orders/preview with the SAME item-shape builder + the applied
  // coupon/points + the selected payment method as the hint, and render the
  // server's total/shipping/discount lines. The "確認付款 NT$X" button then
  // matches what POST /orders will actually charge.
  const [preview, setPreview] = useState<{
    subtotal: number
    shipping: number
    member_discount: number
    campaign_discount: number
    coupon_discount: number
    points_discount: number
    points_used: number
    discount_total: number
    discounts: Array<{ campaign_id: string; name: string; amount: number; type: string }>
    free_shipping_names: string[]
    total: number
  } | null>(null)

  useEffect(() => {
    if (!checkoutData || checkoutData.items.length === 0) {
      setPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const supabase = createClient()
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const res = await fetch(`${API_URL}/orders/preview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            items: buildOrderPreviewItems(checkoutData.items),
            shippingMethod: toApiShippingMethod(
              checkoutData.shippingMethod as CheckoutShippingMethod,
            ),
            paymentMethodHint: paymentMethod,
            ...(couponApplied && couponCode ? { couponCode } : {}),
            ...(pointsUsed > 0 ? { points_used: pointsUsed } : {}),
          }),
        })
        if (cancelled) return
        if (!res.ok) { setPreview(null); return }
        const json = await res.json()
        setPreview(json.data ?? null)
      } catch {
        if (!cancelled) setPreview(null)
      }
    })()
    return () => { cancelled = true }
    // payment method + applied promo change the server total (cvs_cod fee,
    // coupon/points), so refetch on those alongside the cart snapshot.
  }, [checkoutData, paymentMethod, couponApplied, couponCode, pointsUsed])

  // Rotate the idempotency key whenever an order-affecting input changes, so a
  // deliberately different order gets a fresh key (not blocked by the prior
  // submission's cached response). Skipped once submitted — after handoff the
  // order is locked and the key must stay put.
  useEffect(() => {
    if (submittedRef.current) return
    idempotencyKeyRef.current = null
  }, [paymentMethod, couponApplied, couponCode, pointsUsed])

  // Displayed amounts — server preview is authoritative; fall back to the
  // step-1 snapshot only until the preview resolves (or if it errors).
  const shippingFee = preview?.shipping ?? checkoutData?.shippingFee ?? 0
  const memberDiscountAmount = preview
    ? preview.member_discount
    : promo
      ? Math.round(subtotal * memberDiscountRate)
      : 0
  const couponDiscount = preview ? preview.coupon_discount : promoCouponDiscount
  const pointsDiscount = preview ? preview.points_discount : promoPointsDiscount
  const campaignDiscountLines = preview?.discounts ?? []
  const shippingLabel = formatShippingPreviewLabel({
    preview,
    fallbackLabel: `NT$ ${shippingFee.toLocaleString()}`,
  })
  const grandTotal = preview
    ? preview.total
    : Math.max(
        0,
        subtotal - memberDiscountAmount + shippingFee - couponDiscount - pointsDiscount,
      )

  async function handleConfirm() {
    if (!checkoutData) return
    // Already handed off (redirecting / navigating) — never fire a second order.
    if (submittedRef.current) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      // Generate the idempotency key once per attempt; reuse on retries of the
      // SAME attempt (this ref is nulled only when an order-affecting input
      // changes). 36-char UUID satisfies the middleware's 16–100 length gate.
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = crypto.randomUUID()
      }
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKeyRef.current,
      }
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
        overseas_cod: "overseas_cod",
      }
      const shippingMethod =
        shippingMethodMap[checkoutData.shippingMethod] ?? checkoutData.shippingMethod
      const cvsTypeMap: Record<string, string> = { cvs_711: "711", cvs_family: "family" }
      const apiAddress = {
        type: "shipping",
        name: checkoutData.address.name,
        phone: checkoutData.address.phone,
        addressType: shippingMethod === "home_delivery" ? "home"
          : shippingMethod === "overseas_cod" ? "overseas"
          : "cvs",
        address:
          checkoutData.address.addressLine ||
          checkoutData.address.cvsStoreName ||
          undefined,
        city: checkoutData.address.city || undefined,
        district: checkoutData.address.district || undefined,
        postalCode: checkoutData.address.postalCode || undefined,
        cvsStoreId: checkoutData.address.cvsStoreId || undefined,
        cvsType: cvsTypeMap[shippingMethod],
        country: checkoutData.address.country || undefined,
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
          points_used: pointsUsed,
        }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const b = body as { message?: string; error?: string | { fieldErrors?: Record<string, string[]>; formErrors?: string[] }; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } }
        let msg = b.message ?? (typeof b.error === "string" ? b.error : "")
        // Surface zod-style validation errors when present (debug-friendly)
        const details = b.details ?? (typeof b.error === "object" ? b.error : undefined)
        if (!msg && details) {
          const fields = Object.entries(details.fieldErrors ?? {})
            .map(([k, v]) => `${k}: ${(v as string[]).join(", ")}`)
            .join("; ")
          const forms = (details.formErrors ?? []).join("; ")
          msg = [fields, forms].filter(Boolean).join(" | ")
        }
        if (!msg) msg = `建立訂單失敗 (HTTP ${res.status})`
        // Log full body for console debugging (admin testing especially)
        console.warn("[orders] create failed:", res.status, body)
        throw new Error(msg)
      }

      const data = await res.json() as {
        data?: { orderId?: string; orderNumber?: string; paymentUrl?: string }
      }
      const paymentUrl = data?.data?.paymentUrl
      const returnedOrderNumber = data?.data?.orderNumber as string | undefined

      if (paymentUrl) {
        // Redirect to payment gateway (PChomePay / LINE Pay / JKOPay).
        // Cart + promo clearing happens on the confirm page once the server
        // reports success — NOT here. If the gateway payment fails, the user
        // is sent back to "重新付款" and must keep their cart + applied
        // coupon/points so the retried order charges the same amount.
        // Lock the button BEFORE the redirect so the `finally` can't re-enable
        // it mid-navigation and let an impatient user submit twice.
        submittedRef.current = true
        setSubmitted(true)
        toast.success("正在前往付款頁面...")
        window.location.href = paymentUrl
      } else if (paymentMethod === "cvs_cod" && returnedOrderNumber) {
        // CVS COD：訂單已成立，直接跳確認頁（不需線上付款）
        submittedRef.current = true
        setSubmitted(true)
        toast.success("訂單已成立！")
        // 清空購物車
        const cartStore = await import("@/lib/cart")
        cartStore.useCart.getState().clear()
        clearPromoState()
        router.push(`/checkout/confirm?order=${encodeURIComponent(returnedOrderNumber)}&method=cvs_cod`)
      } else if (paymentMethod === "test_paid" && returnedOrderNumber) {
        // Admin 沙盒：訂單建立 + 全 pipeline 已跑（發票/通知/庫存/點數），直跳 confirm
        submittedRef.current = true
        setSubmitted(true)
        toast.success("🧪 沙盒訂單已成立（跳過金流）")
        const cartStore = await import("@/lib/cart")
        cartStore.useCart.getState().clear()
        clearPromoState()
        router.push(`/checkout/confirm?order=${encodeURIComponent(returnedOrderNumber)}&method=test_paid`)
      } else {
        setError("無法取得付款連結，請稍後再試或聯繫客服")
      }
    } catch (err) {
      toast.error("建立訂單失敗")
      setError(err instanceof Error ? err.message : "付款失敗，請稍後再試")
    } finally {
      // Don't re-enable after a successful handoff — keep the button disabled
      // through the redirect / route change. Only reset on a failed attempt so
      // the user can retry (same idempotency key replays a server-created order
      // rather than duplicating it).
      if (!submittedRef.current) setLoading(false)
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
                <p><span className="text-zinc-500 inline-block w-16">地址</span>{checkoutData.address.country ? `${checkoutData.address.country} ` : ""}{checkoutData.address.city}{checkoutData.address.district}{checkoutData.address.addressLine}</p>
              )}
              {checkoutData.shippingMethod === "overseas_cod" && (
                <div className="mt-2 rounded bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800">
                  🌍 海外到付：運費由司機收取，請線上完成商品金額付款
                </div>
              )}
              {forcedPayment === "cvs_cod" && (
                <div className="mt-2 rounded bg-blue-50 border border-blue-200 p-2 text-xs text-blue-800">
                  💵 超商取貨付款：到超商取貨時以現金付款，無須線上付款
                </div>
              )}
            </div>
          </section>

          {/* Promo summary — coupon / points / member discount were applied at
              step 1. Show a read-only roll-up here with a link back to edit. */}
          {(couponApplied || pointsUsed > 0 || memberDiscountAmount > 0) && (
            <section className="rounded-lg border bg-emerald-50/50 p-4 space-y-1.5 text-sm">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-sm text-emerald-900">已套用折抵</h2>
                <Link href="/checkout" className="text-xs text-primary hover:underline">修改</Link>
              </div>
              {memberDiscountAmount > 0 && (
                <p className="text-emerald-700">
                  👑 {tierName} {Math.round(memberDiscountRate * 100)}% off
                  <span className="float-right">- NT$ {memberDiscountAmount.toLocaleString()}</span>
                </p>
              )}
              {couponApplied && (
                <p className="text-emerald-700">
                  🎟 優惠碼 <strong>{couponCode}</strong>
                  <span className="float-right">- NT$ {couponDiscount.toLocaleString()}</span>
                </p>
              )}
              {pointsUsed > 0 && (
                <p className="text-emerald-700">
                  ✨ 點數折抵（{pointsUsed.toLocaleString()} 點）
                  <span className="float-right">- NT$ {pointsDiscount.toLocaleString()}</span>
                </p>
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

          {paymentMethod === "cvs_cod" && (
            <div className="rounded-lg bg-zinc-50 border border-zinc-200 p-3 text-sm text-zinc-600 space-y-1">
              <p className="font-medium">🏪 超商取貨付款流程</p>
              <ol className="list-decimal list-inside space-y-0.5 text-xs text-zinc-500">
                <li>訂單成立後，包裹寄至您選擇的超商</li>
                <li>超商簡訊通知到貨後，前往取貨</li>
                <li>取貨時現場付款給店員（現金）</li>
              </ol>
            </div>
          )}

          {/* Mobile Order Total */}
          <div className="lg:hidden rounded-lg border bg-zinc-50/50 p-4">
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-zinc-500">
                <span>商品小計</span>
                <span>NT$ {subtotal.toLocaleString()}</span>
              </div>
              {campaignDiscountLines.map(d => (
                <div key={d.campaign_id} className="flex justify-between text-green-600">
                  <span>{d.name}</span>
                  <span>-NT$ {d.amount.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between text-zinc-500">
                <span>運費</span>
                <span>{shippingLabel}</span>
              </div>
              {memberDiscountAmount > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>{tierName ?? "會員"}折扣 ({Math.round(memberDiscountRate * 100)}% off)</span>
                  <span>-NT$ {memberDiscountAmount.toLocaleString()}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>優惠碼 {couponCode}</span>
                  <span>-NT$ {couponDiscount.toLocaleString()}</span>
                </div>
              )}
              {pointsDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>公益點數折抵 ({pointsUsed.toLocaleString()} 點)</span>
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
              disabled={loading || submitted}
            >
              {loading || submitted ? "處理中..." : `確認付款 NT$ ${grandTotal.toLocaleString()}`}
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
              {campaignDiscountLines.map(d => (
                <div key={d.campaign_id} className="flex justify-between text-green-600">
                  <span>{d.name}</span>
                  <span>-NT$ {d.amount.toLocaleString()}</span>
                </div>
              ))}
              <div className="flex justify-between text-zinc-500">
                <span>運費</span>
                <span>{shippingLabel}</span>
              </div>
              {memberDiscountAmount > 0 && (
                <div className="flex justify-between text-amber-600">
                  <span>{tierName ?? "會員"}折扣 ({Math.round(memberDiscountRate * 100)}% off)</span>
                  <span>-NT$ {memberDiscountAmount.toLocaleString()}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>優惠碼 {couponCode}</span>
                  <span>-NT$ {couponDiscount.toLocaleString()}</span>
                </div>
              )}
              {pointsDiscount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>公益點數折抵 ({pointsUsed.toLocaleString()} 點)</span>
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
