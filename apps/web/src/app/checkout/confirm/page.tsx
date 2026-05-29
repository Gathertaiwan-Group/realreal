"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useCart } from "@/lib/cart"
import { Button } from "@/components/ui/button"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

function getEstimatedDelivery(): string {
  const now = new Date()
  const delivery = new Date(now)
  delivery.setDate(delivery.getDate() + 5)
  // Skip to Monday if it lands on a weekend
  const day = delivery.getDay()
  if (day === 0) delivery.setDate(delivery.getDate() + 1)
  if (day === 6) delivery.setDate(delivery.getDate() + 2)
  return `${delivery.getFullYear()}/${String(delivery.getMonth() + 1).padStart(2, "0")}/${String(delivery.getDate()).padStart(2, "0")}`
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
                    isActive || isCompleted ? "text-foreground" : "text-zinc-400"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`mx-3 h-px w-8 sm:w-12 ${
                    step.num < current ? "" : "bg-zinc-200"
                  }`}
                  style={step.num < current ? { backgroundColor: "rgba(16,48,90,0.4)" } : undefined}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

type PaymentStatus = "success" | "pending" | "failed" | "loading"

function deriveOrderNumber(sp: URLSearchParams): string | null {
  // LINE Pay redirect: ?order=<orderNumber>&status=success
  // PChomePay OrderResultURL: ?MerchantTradeNo=<orderNumber>&RtnCode=1
  // JKOPay result_url: ?merchant_trade_no=<orderNumber>
  return (
    sp.get("order") ||
    sp.get("MerchantTradeNo") ||
    sp.get("merchant_trade_no") ||
    sp.get("orderNumber") ||
    null
  )
}

function mapPaymentStatus(payment_status: string | undefined): PaymentStatus {
  if (payment_status === "paid" || payment_status === "captured") return "success"
  if (payment_status === "failed") return "failed"
  return "pending"
}

export default function ConfirmPage() {
  const searchParams = useSearchParams()
  const clearCart = useCart((s) => s.clear)
  const cleanedUp = useRef(false)

  const orderNumber = deriveOrderNumber(searchParams) ?? "---"
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("loading")
  const estimatedDelivery = getEstimatedDelivery()

  // Server-side truth: fetch the real payment_status from the API.
  // URL params from the gateway redirect can lie (a hostile redirect could
  // forge ?status=success), so we always trust the DB.
  useEffect(() => {
    if (orderNumber === "---") {
      // No order info → derive a soft default from URL (failed only if
      // the gateway explicitly told us so)
      const explicit = searchParams.get("status")
      setPaymentStatus(
        explicit === "failed" || explicit === "fail" || searchParams.get("success") === "false"
          ? "failed"
          : "pending",
      )
      return
    }
    let cancelled = false
    fetch(`${API_URL}/orders/by-number/${encodeURIComponent(orderNumber)}/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return
        const ps = (res?.data?.payment_status as string | undefined) ?? undefined
        setPaymentStatus(mapPaymentStatus(ps))
      })
      .catch(() => {
        if (!cancelled) setPaymentStatus("pending")
      })
    return () => {
      cancelled = true
    }
  }, [orderNumber, searchParams])

  // Clear cart and checkout data once on mount
  useEffect(() => {
    if (cleanedUp.current) return
    cleanedUp.current = true

    // Clear the zustand persisted cart
    clearCart()
    // Clear localStorage checkout data saved during the checkout flow
    try {
      localStorage.removeItem("realreal-checkout")
    } catch {
      // ignore — SSR or storage unavailable
    }
  }, [clearCart])

  if (paymentStatus === "loading") {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <StepIndicator current={3} />
        <div className="text-center py-10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-zinc-200 border-t-[#10305a]" />
          <p className="text-sm text-zinc-500">確認付款狀態中…</p>
        </div>
      </div>
    )
  }

  if (paymentStatus === "failed") {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <StepIndicator current={3} />
        <div className="text-center">
          {/* Failed Icon */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-10 w-10 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold mb-2">付款失敗</h1>
          <p className="text-zinc-500 mb-8">
            您的付款未能成功處理，請重新嘗試或選擇其他付款方式。
          </p>

          {orderNumber !== "---" && (
            <div className="rounded-lg border bg-zinc-50/50 p-6 mb-6 text-left">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">訂單編號</p>
              <p className="font-mono font-semibold text-lg">{orderNumber}</p>
            </div>
          )}

          <div className="space-y-3">
            <Link href="/checkout/payment" className="block">
              <Button className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }}>重新付款</Button>
            </Link>
            <Link href="/shop" className="block">
              <Button variant="outline" className="w-full rounded-[10px]" style={{ borderColor: "#10305a", color: "#10305a" }}>返回商店</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (paymentStatus === "pending") {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <StepIndicator current={3} />
        <div className="text-center">
          {/* Pending Icon */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-100">
            <svg
              className="h-10 w-10 text-yellow-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>

          <h1 className="text-2xl font-bold mb-2">付款確認中</h1>
          <p className="text-zinc-500 mb-8">
            您的訂單已建立，付款正在確認中。<br />
            確認完成後，我們會透過 Email 通知您。
          </p>

          {orderNumber !== "---" && (
            <div className="rounded-lg border bg-zinc-50/50 p-6 mb-6 text-left">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wide">訂單編號</p>
                  <p className="font-mono font-semibold text-lg">{orderNumber}</p>
                </div>
                <span className="inline-flex items-center rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
                  付款確認中
                </span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Link href="/my-account/orders" className="block">
              <Button className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }}>查看我的訂單</Button>
            </Link>
            <Link href="/shop" className="block">
              <Button variant="outline" className="w-full rounded-[10px]" style={{ borderColor: "#10305a", color: "#10305a" }}>繼續購物</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // paymentStatus === "success"
  return (
    <div className="container mx-auto px-4 py-8 max-w-lg">
      <StepIndicator current={3} />

      <div className="text-center">
        {/* Success Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(16,48,90,0.1)" }}>
          <svg
            className="h-10 w-10"
            style={{ color: "#10305a" }}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>

        <h1 className="text-2xl font-bold mb-2">訂單已成立！</h1>
        <p className="text-zinc-500 mb-8">
          感謝您的購買，我們將盡快為您處理。<br />
          訂單確認信已寄送至您的電子信箱。
        </p>

        {/* Order Details Card */}
        <div className="rounded-lg border bg-zinc-50/50 p-6 mb-6 text-left space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide">訂單編號</p>
              <p className="font-mono font-semibold text-lg">{orderNumber}</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
              處理中
            </span>
          </div>

          <div className="border-t pt-4 space-y-2">
            <div className="flex items-start gap-3">
              <span className="text-zinc-400 mt-0.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0H21M3.375 14.25h17.25M21 12.75V8.625A2.625 2.625 0 0018.375 6H5.625A2.625 2.625 0 003 8.625v4.125" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-medium">預計送達日期</p>
                <p className="text-sm text-zinc-500">{estimatedDelivery} 前</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-zinc-400 mt-0.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-medium">出貨通知</p>
                <p className="text-sm text-zinc-500">商品出貨後，我們會透過 Email 及簡訊通知您</p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Link href="/my-account/orders" className="block">
            <Button className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }}>查看我的訂單</Button>
          </Link>
          <Link href="/shop" className="block">
            <Button variant="outline" className="w-full rounded-[10px]" style={{ borderColor: "#10305a", color: "#10305a" }}>繼續購物</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
