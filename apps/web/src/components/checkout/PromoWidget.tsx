"use client"

/**
 * PromoWidget — checkout step 1's promo entry (coupon + points + member discount).
 *
 * Why this lives at step 1 (not step 2 like the original payment page):
 * Baymard Institute research on cart abandonment ranks "could not see total
 * cost upfront" as the #1 reason (~50%). Surfacing promo entry BEFORE the
 * user invests time typing address details lifts conversion. Industry
 * standard (Amazon / Shopify / Shopee / Momo) all keep payment-gateway
 * selection at step 2 (it interlocks with shipping method) but expose the
 * discount-application surface at step 1 or in the cart drawer.
 *
 * State is persisted to localStorage under `PROMO_KEY` and broadcast via the
 * `realreal-promo-change` CustomEvent. The payment page reads the same key
 * on mount to restore the applied promo, and the order-summary sidebars on
 * both step 1 and step 2 subscribe to the CustomEvent so they refresh
 * without prop drilling.
 *
 * IMPORTANT: This widget calls /coupons/validate and /points/apply for the
 * display discount amount. The server canonical recompute happens at
 * POST /orders (orders.ts). Race on coupon used_count is handled there via
 * atomic_increment_coupon_usage RPC; here we may briefly show a discount the
 * server later rejects — that case is rare and the order endpoint will fall
 * back gracefully (silently skip the coupon).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { API_URL } from "@/lib/api-url"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export const PROMO_KEY = "realreal-checkout-promo"
export const PROMO_EVENT = "realreal-promo-change"
export const PROMO_TTL_MS = 30 * 60 * 1000

export type PromoState = {
  couponCode: string
  couponApplied: boolean
  couponDiscount: number // dollars
  couponError: string
  pointsInput: string
  pointsBalance: number
  pointsUsed: number
  pointsDiscount: number // dollars
  pointsAllowed: boolean
  pointsReason: string
  pointsRatio: number
  allowCouponStack: boolean
  memberDiscountRate: number // 0..1
  tierName: string | null
  subtotalAtApply: number
  expiresAt: number
}

const DEFAULT_PROMO: PromoState = {
  couponCode: "",
  couponApplied: false,
  couponDiscount: 0,
  couponError: "",
  pointsInput: "",
  pointsBalance: 0,
  pointsUsed: 0,
  pointsDiscount: 0,
  pointsAllowed: true,
  pointsReason: "",
  pointsRatio: 1,
  allowCouponStack: true,
  memberDiscountRate: 0,
  tierName: null,
  subtotalAtApply: 0,
  expiresAt: 0,
}

export function readPromoState(): PromoState {
  if (typeof window === "undefined") return DEFAULT_PROMO
  try {
    const raw = localStorage.getItem(PROMO_KEY)
    if (!raw) return DEFAULT_PROMO
    const parsed = JSON.parse(raw) as PromoState
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
      localStorage.removeItem(PROMO_KEY)
      return DEFAULT_PROMO
    }
    return { ...DEFAULT_PROMO, ...parsed }
  } catch {
    return DEFAULT_PROMO
  }
}

function writePromoState(s: PromoState) {
  if (typeof window === "undefined") return
  try {
    const withTtl: PromoState = { ...s, expiresAt: Date.now() + PROMO_TTL_MS }
    localStorage.setItem(PROMO_KEY, JSON.stringify(withTtl))
    window.dispatchEvent(new CustomEvent(PROMO_EVENT))
  } catch {
    // Quota exceeded / private browsing — promo just won't persist; UX still works in-page.
  }
}

export function clearPromoState() {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(PROMO_KEY)
    window.dispatchEvent(new CustomEvent(PROMO_EVENT))
  } catch {}
}

export function PromoWidget({ subtotal }: { subtotal: number }) {
  const [state, setState] = useState<PromoState>(DEFAULT_PROMO)
  const [hydrated, setHydrated] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [couponLoading, setCouponLoading] = useState(false)
  const lastSubtotalRef = useRef(0)

  // Restore from localStorage on mount
  useEffect(() => {
    setState(readPromoState())
    setHydrated(true)
  }, [])

  // Persist on every state change (after hydration so we don't clobber stored state on mount)
  useEffect(() => {
    if (!hydrated) return
    writePromoState(state)
  }, [state, hydrated])

  // Fetch member discount + points balance on mount (auth users only)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token || cancelled) return
        setIsLoggedIn(true)
        const headers = { Authorization: `Bearer ${session.access_token}` }
        const [memberRes, pointsRes] = await Promise.all([
          fetch(`${API_URL}/my-member-discount`, { headers }),
          fetch(`${API_URL}/points/balance`, { headers }),
        ])
        if (cancelled) return
        const updates: Partial<PromoState> = {}
        if (memberRes.ok) {
          const m = await memberRes.json() as { data?: { discountRate?: number; tierName?: string | null } }
          if (m?.data?.discountRate && m.data.discountRate > 0) {
            updates.memberDiscountRate = m.data.discountRate
            updates.tierName = m.data.tierName ?? null
          }
        }
        if (pointsRes.ok) {
          const p = await pointsRes.json() as {
            data?: { balance?: number; ratio?: number; allow_coupon_stack?: boolean }
          }
          updates.pointsBalance = Math.max(0, p?.data?.balance ?? 0)
          if (typeof p?.data?.ratio === "number") updates.pointsRatio = p.data.ratio
          if (typeof p?.data?.allow_coupon_stack === "boolean") updates.allowCouponStack = p.data.allow_coupon_stack
        }
        if (Object.keys(updates).length > 0 && !cancelled) {
          setState(s => ({ ...s, ...updates }))
        }
      } catch {
        // Silently fail — promos are optional
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Re-validate coupon when subtotal changes (cart edits after coupon applied)
  const applyCouponCore = useCallback(async (codeRaw: string, currentSubtotal: number) => {
    const code = codeRaw.trim()
    if (!code) {
      setState(s => ({ ...s, couponError: "請輸入優惠碼" }))
      return
    }
    setCouponLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const res = await fetch(`${API_URL}/coupons/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ code, order_amount: currentSubtotal }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "無效的優惠碼" }))
        setState(s => ({
          ...s,
          couponError: (body as { error?: string }).error ?? "無效的優惠碼",
          couponApplied: false,
          couponDiscount: 0,
        }))
        return
      }
      const body = await res.json() as { data?: { discount?: number } }
      const discountAmount = body?.data?.discount ?? 0
      setState(s => ({
        ...s,
        couponCode: code,
        couponDiscount: discountAmount,
        couponApplied: true,
        couponError: "",
        subtotalAtApply: currentSubtotal,
      }))
    } catch {
      setState(s => ({ ...s, couponError: "驗證優惠碼時發生錯誤", couponApplied: false, couponDiscount: 0 }))
    } finally {
      setCouponLoading(false)
    }
  }, [])

  // Subtotal changed after coupon was applied → silently revalidate
  useEffect(() => {
    if (!hydrated) return
    if (!state.couponApplied) {
      lastSubtotalRef.current = subtotal
      return
    }
    if (lastSubtotalRef.current === subtotal) return
    if (subtotal === state.subtotalAtApply) {
      lastSubtotalRef.current = subtotal
      return
    }
    lastSubtotalRef.current = subtotal
    void applyCouponCore(state.couponCode, subtotal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal, hydrated, state.couponApplied])

  function handleRemoveCoupon() {
    setState(s => ({ ...s, couponCode: "", couponApplied: false, couponDiscount: 0, couponError: "" }))
  }

  // Debounced points apply
  useEffect(() => {
    if (!hydrated) return
    if (state.pointsBalance === 0) return
    const blocked = state.couponApplied && !state.allowCouponStack
    if (blocked) {
      if (state.pointsUsed !== 0 || state.pointsDiscount !== 0) {
        setState(s => ({ ...s, pointsUsed: 0, pointsDiscount: 0, pointsReason: "" }))
      }
      return
    }
    const requested = Number.parseInt(state.pointsInput, 10)
    if (!Number.isFinite(requested) || requested <= 0) {
      if (state.pointsUsed !== 0 || state.pointsDiscount !== 0) {
        setState(s => ({ ...s, pointsUsed: 0, pointsDiscount: 0, pointsReason: "" }))
      }
      return
    }
    const handle = setTimeout(async () => {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return
        const cart = { subtotal, shipping: 0, total: subtotal, sale_item_total: 0 }
        const res = await fetch(`${API_URL}/points/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ requested, cart }),
        })
        if (!res.ok) {
          setState(s => ({ ...s, pointsAllowed: false, pointsReason: "無法套用點數", pointsUsed: 0, pointsDiscount: 0 }))
          return
        }
        const body = await res.json() as { data?: { discount?: number; allowed?: boolean; reason?: string } }
        const allowed = body?.data?.allowed ?? false
        const d = body?.data?.discount ?? 0
        const reason = body?.data?.reason ?? ""
        if (allowed) {
          setState(s => ({ ...s, pointsAllowed: true, pointsReason: reason, pointsUsed: requested, pointsDiscount: d }))
        } else {
          setState(s => ({ ...s, pointsAllowed: false, pointsReason: reason, pointsUsed: 0, pointsDiscount: 0 }))
        }
      } catch {
        setState(s => ({ ...s, pointsAllowed: false, pointsReason: "套用點數時發生錯誤", pointsUsed: 0, pointsDiscount: 0 }))
      }
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pointsInput, state.couponApplied, state.allowCouponStack, subtotal, state.pointsBalance, hydrated])

  if (!hydrated) {
    return (
      <section className="rounded-lg border bg-white p-4">
        <p className="text-sm text-zinc-400">載入折抵與點數中…</p>
      </section>
    )
  }

  const pointsBlockedByCoupon = state.couponApplied && !state.allowCouponStack
  const memberDiscountAmount = Math.round(subtotal * state.memberDiscountRate)

  return (
    <section className="rounded-lg border bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base">💰 折抵與優惠</h2>
      </div>

      {/* Member discount — auto-applied, no input */}
      {state.tierName && state.memberDiscountRate > 0 && (
        <div className="flex items-center justify-between rounded bg-emerald-50 border border-emerald-200 p-3 text-sm">
          <span>
            👑 <strong>{state.tierName}</strong> {Math.round(state.memberDiscountRate * 100)}% off
            <span className="text-emerald-700 ml-2 text-xs">(自動套用)</span>
          </span>
          <span className="text-emerald-700 font-semibold">- NT$ {memberDiscountAmount.toLocaleString()}</span>
        </div>
      )}

      {/* Coupon section */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">🎟 優惠碼</Label>
          <span className="text-xs text-zinc-500">優惠碼區分大小寫</span>
        </div>
        {state.couponApplied ? (
          <div className="flex items-center justify-between rounded bg-emerald-50 border border-emerald-200 p-3 text-sm">
            <span>
              <strong>{state.couponCode}</strong>
              <span className="text-emerald-700 ml-2">已套用</span>
            </span>
            <div className="flex items-center gap-3">
              <span className="text-emerald-700 font-semibold">- NT$ {state.couponDiscount.toLocaleString()}</span>
              <button
                type="button"
                onClick={handleRemoveCoupon}
                className="text-xs text-red-600 hover:underline"
              >
                移除
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              value={state.couponCode}
              onChange={(e) => setState(s => ({ ...s, couponCode: e.target.value, couponError: "" }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  void applyCouponCore(state.couponCode, subtotal)
                }
              }}
              placeholder="輸入優惠碼"
              className="flex-1"
            />
            <Button
              type="button"
              onClick={() => void applyCouponCore(state.couponCode, subtotal)}
              disabled={couponLoading || !state.couponCode.trim()}
            >
              {couponLoading ? "驗證中…" : "套用"}
            </Button>
          </div>
        )}
        {state.couponError && <p className="text-xs text-red-600">{state.couponError}</p>}
      </div>

      {/* Points section */}
      {isLoggedIn ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-medium">✨ 公益存款</Label>
              {state.pointsBalance > 0 && (
                <span className="text-xs text-zinc-500">可選擇折抵消費或留作公益</span>
              )}
            </div>
            <span className="text-xs text-zinc-500">
              餘額 <strong>{state.pointsBalance.toLocaleString()}</strong> 點
              {state.pointsBalance > 0 && (
                <span className="text-zinc-400 ml-1">(= NT$ {Math.floor(state.pointsBalance * state.pointsRatio).toLocaleString()})</span>
              )}
            </span>
          </div>
          {state.pointsBalance === 0 ? (
            <p className="text-xs text-zinc-500 leading-relaxed">
              累積消費可獲得公益點數，下次購物可折抵金額。
            </p>
          ) : pointsBlockedByCoupon ? (
            <div className="rounded bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700">
              已使用優惠券，無法同時使用點數
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  max={state.pointsBalance}
                  value={state.pointsInput}
                  onChange={(e) => setState(s => ({ ...s, pointsInput: e.target.value }))}
                  placeholder="輸入要使用的點數"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setState(s => ({ ...s, pointsInput: String(s.pointsBalance) }))}
                >
                  全部使用
                </Button>
              </div>
              {state.pointsReason && !state.pointsAllowed && (
                <p className="text-xs text-amber-700">{state.pointsReason}</p>
              )}
              {state.pointsDiscount > 0 && state.pointsAllowed && (
                <p className="text-xs text-emerald-700">
                  將折抵 <strong>- NT$ {state.pointsDiscount.toLocaleString()}</strong>
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        /* Guest: informational card to introduce 公益存款 and encourage sign-up */
        <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: "#10305a" }}>✨ 公益存款</span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ backgroundColor: "#10305a" }}>
              會員專屬
            </span>
          </div>
          <p className="text-xs text-zinc-600 leading-relaxed">
            成為誠真會員，每次消費自動累積<strong>公益存款點數</strong>。<br />
            點數可折抵下次購物，也可選擇留存為公益捐款，讓消費也能做好事。
          </p>
          <a
            href="/auth/register"
            className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
            style={{ color: "#10305a" }}
          >
            立即免費加入，開始累積點數 →
          </a>
        </div>
      )}
    </section>
  )
}
