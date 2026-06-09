"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useCart } from "@/lib/cart"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InvoiceSelector, type InvoiceData } from "@/components/checkout/InvoiceSelector"
import { API_URL } from "@/lib/api-url"
import {
  PromoWidget,
  readPromoState,
  PROMO_EVENT,
  type PromoState,
} from "@/components/checkout/PromoWidget"

type AddressType = "home" | "cvs" | "overseas"
type ShippingMethod = "711" | "family" | "home_delivery" | "overseas_cod"

/**
 * Cross-window contract for ECPay CVS store picker.
 * Spec: docs/superpowers/specs/2026-05-30-ecpay-cvs-popup-flow-design.md
 */
type CvsMessage = {
  type: "cvs-selected"
  storeId: string
  storeName: string
  address?: string
  subType?: "FAMIC2C" | "UNIMARTC2C"
}

type CvsDraft = {
  name: string
  phone: string
  email: string
  addressType: AddressType
  city: string
  district: string
  postalCode: string
  addressLine: string
  shippingMethod: ShippingMethod
  invoice: InvoiceData
  expiresAt: number
  country: string
}

const CVS_DRAFT_KEY = "realreal-cvs-draft"
const CVS_DRAFT_TTL_MS = 5 * 60_000

const SHIPPING_LABELS: Record<ShippingMethod, string> = {
  "711": "7-11取貨",
  "family": "全家取貨",
  "home_delivery": "宅配",
  "overseas_cod": "海外寄送（到付）",
}

const SHIPPING_FEES: Record<ShippingMethod, number> = {
  "711": 65,
  "family": 65,
  "home_delivery": 150,
  "overseas_cod": 0,
}

const FREE_SHIPPING_THRESHOLD: Record<ShippingMethod, number> = {
  "711": 499,
  "family": 499,
  "home_delivery": 1499,
  "overseas_cod": 0,
}

function getShippingFee(method: ShippingMethod, subtotal: number): number {
  return subtotal >= FREE_SHIPPING_THRESHOLD[method] ? 0 : SHIPPING_FEES[method]
}

function formatShippingFee(method: ShippingMethod, subtotal: number): string {
  const fee = getShippingFee(method, subtotal)
  if (fee === 0) return "免運"
  return `NT$ ${fee}`
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
                    isCompleted ? "bg-zinc-200" : "bg-zinc-200"
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

type FieldErrors = {
  name?: string
  phone?: string
  email?: string
  city?: string
  postalCode?: string
  address?: string
  cvsStore?: string
  country?: string
}

export default function CheckoutPage() {
  const router = useRouter()
  const items = useCart(s => s.items)
  const total = useCart(s => s.total)
  const [hydrated, setHydrated] = useState(false)

  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [addressType, setAddressType] = useState<AddressType>("home")
  const [city, setCity] = useState("")
  const [district, setDistrict] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [addressLine, setAddressLine] = useState("")
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("home_delivery")
  const [cvsStoreName, setCvsStoreName] = useState("")
  const [cvsStoreId, setCvsStoreId] = useState("")
  const [cvsAddress, setCvsAddress] = useState("")
  const [country, setCountry] = useState("")
  const [invoice, setInvoice] = useState<InvoiceData>({ type: "B2C_2" })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const searchParams = useSearchParams()

  // 1. Draft restore — must run BEFORE the URL-params useEffect so its setState
  //    doesn't get overwritten by the (potentially empty) post-redirect state.
  //    Only runs once on mount.
  useEffect(() => {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CVS_DRAFT_KEY) : null
    if (!raw) return
    try {
      const draft = JSON.parse(raw) as CvsDraft
      if (!draft || typeof draft.expiresAt !== "number" || Date.now() > draft.expiresAt) {
        localStorage.removeItem(CVS_DRAFT_KEY)
        return
      }
      if (draft.name) setName(draft.name)
      if (draft.phone) setPhone(draft.phone)
      if (draft.email) setEmail(draft.email)
      if (draft.addressType) setAddressType(draft.addressType)
      if (draft.city) setCity(draft.city)
      if (draft.district) setDistrict(draft.district)
      if (draft.postalCode) setPostalCode(draft.postalCode)
      if (draft.addressLine) setAddressLine(draft.addressLine)
      if (draft.shippingMethod) setShippingMethod(draft.shippingMethod)
      if (draft.invoice) setInvoice(draft.invoice)
      if (draft.country) setCountry(draft.country)
    } catch {
      // bad json → fall through to cleanup
    } finally {
      localStorage.removeItem(CVS_DRAFT_KEY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2. Cart hydration
  useEffect(() => {
    useCart.persist.rehydrate()
    setHydrated(true)
  }, [])

  // 2b. Pre-fill email + name + phone + tax_id from the logged-in account
  //     (spec R). Required fields + auto-fill = no re-typing for return
  //     customers. Lazy import keeps the supabase client out of SSR bundle.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { createClient } = await import("@/lib/supabase/client")
      const supabase = createClient()
      const { data } = await supabase.auth.getUser()
      if (cancelled) return
      const user = data.user
      if (!user) return

      if (!email && user.email) setEmail(user.email)

      // Fetch profile fields for name / phone / tax_id prefill
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name, phone, tax_id")
        .eq("user_id", user.id)
        .maybeSingle()
      if (cancelled || !profile) return
      const p = profile as { display_name: string | null; phone: string | null; tax_id: string | null }
      if (!name && p.display_name) setName(p.display_name)
      if (!phone && p.phone) setPhone(p.phone)
      if (p.tax_id) {
        // Upgrade to B2B invoice with the saved tax id when user hasn't picked another option.
        setInvoice(prev =>
          prev.type === "B2C_2" && !prev.taxId
            ? { ...prev, type: "B2B", taxId: p.tax_id ?? undefined }
            : prev,
        )
      }

      // Pre-fill address from the most recent home-delivery order address
      const { data: recentOrders } = await supabase
        .from("orders")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10)
      if (cancelled || !recentOrders?.length) return
      const { data: lastAddr } = await supabase
        .from("order_addresses")
        .select("name, phone, city, postal_code, address")
        .in("order_id", recentOrders.map((o: { id: string }) => o.id))
        .eq("address_type", "home")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled || !lastAddr) return
      const a = lastAddr as { name: string | null; phone: string | null; city: string | null; postal_code: string | null; address: string | null }
      if (!name && a.name) setName(a.name)
      if (!phone && a.phone) setPhone(a.phone)
      if (a.city) setCity(a.city)
      if (a.postal_code) setPostalCode(a.postal_code)
      if (a.address) setAddressLine(a.address)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2c. Spec R Section 1 — call POST /orders/preview whenever cart or shipping
  //     changes so the summary can show 首購折抵 / 滿額贈品 / 等活動 lines BEFORE
  //     the user pays. Debounced 300ms.
  const [preview, setPreview] = useState<{
    subtotal: number
    shipping: number
    discount_total: number
    discounts: Array<{ campaign_id: string; name: string; amount: number; type: string }>
    free_items: Array<{ sku?: string; product_id?: string; qty: number; name?: string }>
    free_shipping_names: string[]
    total: number
  } | null>(null)
  const itemsKey = useMemo(
    () => items.map(i => i.variantId + ":" + i.qty).sort().join("|"),
    [items],
  )
  useEffect(() => {
    if (items.length === 0) {
      setPreview(null)
      return
    }
    const t = setTimeout(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client")
        const supabase = createClient()
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const shippingMethodMap: Record<string, string> = {
          "711": "cvs_711",
          family: "cvs_family",
          home_delivery: "home_delivery",
          overseas_cod: "overseas_cod",
        }
        const res = await fetch(`${API_URL}/orders/preview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            items: items.map(i => ({
              variantId: i.variantId,
              qty: i.qty,
              unitPrice: Math.round(i.price * 100),
              productName: i.productName,
              variantName: i.variantName,
            })),
            shippingMethod: shippingMethodMap[shippingMethod] ?? "home_delivery",
          }),
        })
        if (!res.ok) { setPreview(null); return }
        const json = await res.json()
        setPreview(json.data ?? null)
      } catch {
        setPreview(null)  // network blip: hide discount lines, keep raw total
      }
    }, 300)
    return () => clearTimeout(t)
    // items intentionally referenced via itemsKey for stable identity (T20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, shippingMethod])

  // 3. Listen for postMessage from the ECPay store-picker popup.
  //    Origin guard prevents third-party tabs from injecting fake selections.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      const data = e.data as Partial<CvsMessage> | null
      if (!data || data.type !== "cvs-selected") return
      if (!data.storeId || !data.storeName) return

      setCvsStoreId(data.storeId)
      setCvsStoreName(data.storeName)
      if (data.address) setCvsAddress(data.address)
      if (data.subType === "FAMIC2C") {
        setShippingMethod("family")
        setAddressType("cvs")
      } else if (data.subType === "UNIMARTC2C") {
        setShippingMethod("711")
        setAddressType("cvs")
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  // 4. ECPay redirected us back with store info in URL params.
  //    If we're the popup → postMessage to opener + close ourselves.
  //    If we're the main tab (C fallback) or opener is gone → update inline.
  useEffect(() => {
    const storeId = searchParams.get("cvsStoreId")
    const storeName = searchParams.get("cvsStoreName")
    if (!storeId || !storeName) return

    const storeAddress = searchParams.get("cvsAddress") ?? undefined
    const subType = searchParams.get("logisticsSubType") ?? undefined

    // Popup path: relay to opener and close.
    if (typeof window !== "undefined" && window.opener && !window.opener.closed) {
      try {
        const msg: CvsMessage = {
          type: "cvs-selected",
          storeId,
          storeName,
          address: storeAddress,
          subType:
            subType === "FAMIC2C" || subType === "FAMI"
              ? "FAMIC2C"
              : subType === "UNIMARTC2C" || subType === "UNIMART"
                ? "UNIMARTC2C"
                : undefined,
        }
        window.opener.postMessage(msg, window.location.origin)
        window.close()
        return
      } catch {
        // postMessage / close blocked → fall through to inline update so the
        // user at least sees their store and can finish manually.
      }
    }

    // Inline path (C fallback's same-tab return, or opener-already-closed edge).
    setCvsStoreId(storeId)
    setCvsStoreName(storeName)
    if (storeAddress) setCvsAddress(storeAddress)
    if (subType === "FAMIC2C" || subType === "FAMI") {
      setShippingMethod("family")
      setAddressType("cvs")
    } else if (subType === "UNIMARTC2C" || subType === "UNIMART") {
      setShippingMethod("711")
      setAddressType("cvs")
    }
    window.history.replaceState({}, "", "/checkout")
  }, [searchParams])

  const saveCvsDraft = useCallback(() => {
    const draft: CvsDraft = {
      name,
      phone,
      email,
      addressType,
      city,
      district,
      postalCode,
      addressLine,
      shippingMethod,
      invoice,
      country,
      expiresAt: Date.now() + CVS_DRAFT_TTL_MS,
    }
    try {
      localStorage.setItem(CVS_DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // localStorage full / private browsing — drop silently; flow still works,
      // user just loses unsaved form state on return.
    }
  }, [
    name,
    phone,
    email,
    addressType,
    city,
    district,
    postalCode,
    addressLine,
    shippingMethod,
    invoice,
    country,
  ])

  const openCvsMap = useCallback(() => {
    const subType = shippingMethod === "family" ? "FAMIC2C" : "UNIMARTC2C"
    const url = `${API_URL}/logistics/map?logisticsSubType=${subType}&isCollection=N`

    const isMobile =
      typeof navigator !== "undefined" &&
      /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)

    // C fallback for mobile: popups are unreliable; same-tab nav is bulletproof.
    if (isMobile) {
      saveCvsDraft()
      window.location.href = url
      return
    }

    const popup = window.open(url, "_blank", "width=800,height=600")
    const blocked = !popup || typeof popup.closed === "undefined"
    if (blocked) {
      // C fallback: popup blocked → save draft and navigate same tab.
      saveCvsDraft()
      window.location.href = url
    }
  }, [shippingMethod, saveCvsDraft])

  // When switching to CVS, auto-select a CVS shipping method.
  // T8: only react to addressType changes — listening to shippingMethod here
  // would fight the user's manual selection (711 vs family).
  useEffect(() => {
    if (addressType === "cvs" && shippingMethod === "home_delivery") {
      setShippingMethod("711")
    }
    if (addressType === "home" && shippingMethod !== "home_delivery") {
      setShippingMethod("home_delivery")
    }
    if (addressType === "overseas") {
      setShippingMethod("overseas_cod")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressType])

  function validate(): FieldErrors {
    const errs: FieldErrors = {}
    if (!name.trim()) errs.name = "請輸入收件人姓名"
    if (!phone.trim()) errs.phone = "請輸入手機號碼"
    else if (addressType !== "overseas" && !/^09\d{8}$/.test(phone.trim())) {
      errs.phone = "手機號碼格式不正確（09xxxxxxxx）"
    }
    if (!email.trim()) errs.email = "請輸入電子信箱"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errs.email = "電子信箱格式不正確"
    }

    if (addressType === "home") {
      if (!city.trim()) errs.city = "請選擇縣市"
      if (!addressLine.trim()) errs.address = "請輸入詳細地址"
    } else if (addressType === "cvs") {
      if (!cvsStoreName) errs.cvsStore = "請選擇取貨門市"
    } else {
      // overseas
      if (!country.trim()) errs.country = "請輸入國家"
      if (!addressLine.trim()) errs.address = "請輸入詳細地址"
    }
    return errs
  }

  function handleBlur(field: string) {
    setTouched(prev => ({ ...prev, [field]: true }))
  }

  function handleNext() {
    const errs = validate()
    setErrors(errs)
    // Mark all as touched to show errors
    setTouched({ name: true, phone: true, email: true, city: true, address: true, cvsStore: true, country: true })
    if (Object.keys(errs).length > 0) return

    const checkoutData = {
      items,
      address: {
        name,
        phone,
        email,
        addressType,
        city,
        district,
        postalCode,
        addressLine,
        cvsStoreName,
        cvsStoreId,
        country,
      },
      shippingMethod,
      shippingFee: getShippingFee(shippingMethod, total()),
      invoice,
    }
    localStorage.setItem("realreal-checkout", JSON.stringify(checkoutData))
    router.push("/checkout/payment")
  }

  // Promo state lifted from step 2 — keeps coupon / points / member discount
  // visible BEFORE the user fills the address form. PromoWidget owns writes;
  // we just subscribe so the sidebar summary refreshes.
  const [promo, setPromo] = useState<PromoState | null>(null)
  useEffect(() => {
    setPromo(readPromoState())
    const handler = () => setPromo(readPromoState())
    window.addEventListener(PROMO_EVENT, handler)
    return () => window.removeEventListener(PROMO_EVENT, handler)
  }, [])

  if (!hydrated) return null

  const subtotal = total()
  const localShippingFee = getShippingFee(shippingMethod, subtotal)
  // Prefer server-computed values from preview (includes campaign-applied free
  // shipping + first-purchase / 滿額贈 etc. discount lines). Fall back to local
  // calc while preview is still in-flight or has errored.
  const shippingFee = preview?.shipping ?? localShippingFee
  const baseTotal = preview?.total ?? subtotal + localShippingFee  // after campaigns + shipping, before promo
  const discountLines = preview?.discounts ?? []
  const freeItemsList = preview?.free_items ?? []
  const freeShippingByCampaign = (preview?.free_shipping_names ?? []).length > 0

  // Promo deductions (member tier discount + coupon + points)
  const memberDiscountAmount = promo ? Math.round(subtotal * promo.memberDiscountRate) : 0
  const couponDiscount = promo?.couponApplied ? promo.couponDiscount : 0
  const pointsDiscount = promo?.pointsAllowed ? promo.pointsDiscount : 0
  const grandTotal = Math.max(0, baseTotal - memberDiscountAmount - couponDiscount - pointsDiscount)

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      <StepIndicator current={1} />

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main Form */}
        <div className="flex-1 min-w-0">
          {items.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-zinc-500 mb-4">購物車是空的</p>
              <Link href="/shop">
                <Button variant="outline">前往選購</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Promo / discount entry — at top of step 1 so customers see
                  the after-discount total BEFORE filling the address form
                  (Baymard cart-abandonment research). */}
              <PromoWidget subtotal={subtotal} />

              <h1 className="text-2xl font-bold">收件資訊</h1>

              {/* Contact Info */}
              <section className="space-y-4">
                <h2 className="text-lg font-semibold border-b pb-2">聯絡資訊</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">
                      姓名 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={e => { setName(e.target.value); if (touched.name) setErrors(prev => ({ ...prev, name: undefined })) }}
                      onBlur={() => handleBlur("name")}
                      placeholder="收件人姓名"
                      className={touched.name && errors.name ? "border-red-400 focus-visible:ring-red-400" : ""}
                    />
                    {touched.name && errors.name && (
                      <p className="text-xs text-red-500">{errors.name}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="phone">
                      手機號碼 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="phone"
                      value={phone}
                      onChange={e => { setPhone(e.target.value); if (touched.phone) setErrors(prev => ({ ...prev, phone: undefined })) }}
                      onBlur={() => handleBlur("phone")}
                      placeholder="09xxxxxxxx"
                      className={touched.phone && errors.phone ? "border-red-400 focus-visible:ring-red-400" : ""}
                    />
                    {touched.phone && errors.phone && (
                      <p className="text-xs text-red-500">{errors.phone}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">
                    電子信箱 <span className="text-red-500">*</span>
                    <span className="ml-1 text-xs text-zinc-500">
                      (寄送訂單通知 + 電子發票)
                    </span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onBlur={() => handleBlur("email")}
                    placeholder="example@email.com"
                    className={touched.email && errors.email ? "border-red-500" : ""}
                  />
                  {touched.email && errors.email && (
                    <p className="text-xs text-red-500">{errors.email}</p>
                  )}
                </div>
              </section>

              {/* Delivery Method */}
              <section className="space-y-4">
                <h2 className="text-lg font-semibold border-b pb-2">配送方式</h2>

                <div className="space-y-2">
                  <Label>取貨方式</Label>
                  <div className="grid grid-cols-3 gap-3">
                    {(["home", "cvs", "overseas"] as AddressType[]).map(type => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setAddressType(type)}
                        className={`flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-colors ${
                          addressType === type
                            ? "border-zinc-200 text-zinc-600"
                            : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                        }`}
                        style={addressType === type ? { borderColor: "#10305a", backgroundColor: "rgba(16,48,90,0.05)", color: "#10305a" } : undefined}
                      >
                        <span>{type === "home" ? "🏠" : type === "cvs" ? "🏪" : "🌍"}</span>
                        <span>{type === "home" ? "宅配到府" : type === "cvs" ? "超商取貨" : "海外寄送"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {addressType === "home" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      {(Object.entries(SHIPPING_LABELS) as [ShippingMethod, string][])
                        .filter(([v]) => v === "home_delivery")
                        .map(([value, label]) => (
                          <label
                            key={value}
                            className={`flex items-center justify-between p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                              shippingMethod === value
                                ? ""
                                : "border-zinc-200 hover:border-zinc-300"
                            }`}
                            style={shippingMethod === value ? { borderColor: "#10305a", backgroundColor: "rgba(16,48,90,0.05)" } : undefined}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name="shippingMethod"
                                value={value}
                                checked={shippingMethod === value}
                                onChange={() => setShippingMethod(value)}
                                className="h-4 w-4 accent-primary"
                              />
                              <span className="font-medium text-sm">🚚 {label}</span>
                            </div>
                            <span className="text-sm text-zinc-500">{formatShippingFee(value, subtotal)}</span>
                          </label>
                        ))}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="postalCode">郵遞區號</Label>
                        <Input
                          id="postalCode"
                          value={postalCode}
                          onChange={e => setPostalCode(e.target.value)}
                          placeholder="100"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="city">
                          縣市 <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="city"
                          value={city}
                          onChange={e => { setCity(e.target.value); if (touched.city) setErrors(prev => ({ ...prev, city: undefined })) }}
                          onBlur={() => handleBlur("city")}
                          placeholder="台北市"
                          className={touched.city && errors.city ? "border-red-400 focus-visible:ring-red-400" : ""}
                        />
                        {touched.city && errors.city && (
                          <p className="text-xs text-red-500">{errors.city}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="district">鄉鎮市區</Label>
                        <Input
                          id="district"
                          value={district}
                          onChange={e => setDistrict(e.target.value)}
                          placeholder="中正區"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="addressLine">
                        詳細地址 <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="addressLine"
                        value={addressLine}
                        onChange={e => { setAddressLine(e.target.value); if (touched.address) setErrors(prev => ({ ...prev, address: undefined })) }}
                        onBlur={() => handleBlur("address")}
                        placeholder="路名、巷弄、樓層"
                        className={touched.address && errors.address ? "border-red-400 focus-visible:ring-red-400" : ""}
                      />
                      {touched.address && errors.address && (
                        <p className="text-xs text-red-500">{errors.address}</p>
                      )}
                    </div>
                  </div>
                )}

                {addressType === "cvs" && (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      {(Object.entries(SHIPPING_LABELS) as [ShippingMethod, string][])
                        .filter(([v]) => v !== "home_delivery" && v !== "overseas_cod")
                        .map(([value, label]) => (
                          <label
                            key={value}
                            className={`flex items-center justify-between p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                              shippingMethod === value
                                ? ""
                                : "border-zinc-200 hover:border-zinc-300"
                            }`}
                            style={shippingMethod === value ? { borderColor: "#10305a", backgroundColor: "rgba(16,48,90,0.05)" } : undefined}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name="shippingMethod"
                                value={value}
                                checked={shippingMethod === value}
                                onChange={() => setShippingMethod(value)}
                                className="h-4 w-4 accent-primary"
                              />
                              <span className="font-medium text-sm">
                                {value === "711" ? "🏪" : "🏬"} {label}
                              </span>
                            </div>
                            <span className="text-sm text-zinc-500">{formatShippingFee(value, subtotal)}</span>
                          </label>
                        ))}
                    </div>

                    {/* CVS Store Selector */}
                    <div className="rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-4">
                      {cvsStoreName ? (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-sm">{cvsStoreName}</p>
                            <p className="text-xs text-zinc-500">門市編號：{cvsStoreId}</p>
                            {cvsAddress && (
                              <p className="text-xs text-zinc-500">{cvsAddress}</p>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setCvsStoreName(""); setCvsStoreId(""); setCvsAddress("") }}
                          >
                            重新選擇
                          </Button>
                        </div>
                      ) : (
                        <div className="text-center space-y-2">
                          <p className="text-sm text-zinc-500">尚未選擇取貨門市</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={openCvsMap}
                          >
                            選擇取貨門市
                          </Button>
                          {touched.cvsStore && errors.cvsStore && (
                            <p className="text-xs text-red-500">{errors.cvsStore}</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {addressType === "overseas" && (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                      📦 運費由司機收取，收到貨品時當場付款。商品金額請線上完成付款。
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="country">
                          國家 / Country <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="country"
                          value={country}
                          onChange={e => { setCountry(e.target.value); if (touched.country) setErrors(prev => ({ ...prev, country: undefined })) }}
                          onBlur={() => handleBlur("country")}
                          placeholder="Japan / 日本"
                          className={touched.country && errors.country ? "border-red-400 focus-visible:ring-red-400" : ""}
                        />
                        {touched.country && errors.country && (
                          <p className="text-xs text-red-500">{errors.country}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="city">
                          城市 / City <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          id="city"
                          value={city}
                          onChange={e => setCity(e.target.value)}
                          placeholder="Tokyo / 東京都"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="addressLine">
                        詳細地址 <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="addressLine"
                        value={addressLine}
                        onChange={e => setAddressLine(e.target.value)}
                        placeholder="街道、區域、郵遞區號"
                      />
                    </div>
                    <p className="text-xs text-zinc-400">
                      運費：<span className="font-medium text-zinc-600">NT$ 0（到付，由司機收取）</span>
                    </p>
                  </div>
                )}
              </section>

              {/* Invoice */}
              <section className="space-y-4">
                <h2 className="text-lg font-semibold border-b pb-2">發票資訊</h2>
                <InvoiceSelector value={invoice} onChange={setInvoice} />
              </section>

              {/* Mobile-only order summary */}
              <section className="lg:hidden space-y-3">
                <h2 className="text-lg font-semibold border-b pb-2">訂單摘要</h2>
                <div className="rounded-lg border divide-y">
                  {items.map(item => (
                    <div key={item.variantId} className="flex items-center justify-between p-3">
                      <div>
                        <p className="font-medium text-sm">{item.productName}</p>
                        <p className="text-xs text-zinc-500">{item.variantName} x {item.qty}</p>
                      </div>
                      <p className="font-medium text-sm">NT$ {(item.price * item.qty).toLocaleString()}</p>
                    </div>
                  ))}
                  <div className="p-3 space-y-1 text-sm">
                    <div className="flex justify-between text-zinc-500">
                      <span>商品小計</span>
                      <span>NT$ {subtotal.toLocaleString()}</span>
                    </div>
                    {discountLines.map(d => (
                      <div key={d.campaign_id} className="flex justify-between text-emerald-700">
                        <span>{d.name}</span>
                        <span>- NT$ {d.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    {freeItemsList.map((g, i) => (
                      <div key={`gift-m-${i}`} className="flex justify-between text-emerald-700">
                        <span>🎁 滿額贈：{g.name ?? g.sku ?? "贈品"} × {g.qty}</span>
                        <span>免費</span>
                      </div>
                    ))}
                    {memberDiscountAmount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>👑 {promo?.tierName} {Math.round((promo?.memberDiscountRate ?? 0) * 100)}% off</span>
                        <span>- NT$ {memberDiscountAmount.toLocaleString()}</span>
                      </div>
                    )}
                    {couponDiscount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>🎟 優惠碼 {promo?.couponCode}</span>
                        <span>- NT$ {couponDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    {pointsDiscount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>✨ 點數折抵（{promo?.pointsUsed} 點）</span>
                        <span>- NT$ {pointsDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-zinc-500">
                      <span>運費</span>
                      <span>{shippingFee === 0 ? (freeShippingByCampaign ? "活動免運" : "免運") : `NT$ ${shippingFee.toLocaleString()}`}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-base pt-1 border-t">
                      <span>合計</span>
                      <span>NT$ {grandTotal.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Link href="/shop" className="sm:order-first">
                  <Button variant="outline" className="w-full sm:w-auto">
                    ← 繼續購物
                  </Button>
                </Link>
                <Button
                  className="flex-1 rounded-[10px]"
                  style={{ backgroundColor: "#10305a", color: "#fff" }}
                  onClick={handleNext}
                  disabled={items.length === 0}
                >
                  下一步：選擇付款方式
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Desktop Order Summary Sidebar */}
        {items.length > 0 && (
          <aside className="hidden lg:block w-80 shrink-0">
            <div className="sticky top-8 rounded-lg border bg-zinc-50/50 p-5 space-y-4">
              <h2 className="font-semibold text-lg">訂單摘要</h2>
              <div className="divide-y">
                {items.map(item => (
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
                {discountLines.map(d => (
                  <div key={d.campaign_id} className="flex justify-between text-emerald-700 font-medium">
                    <span>{d.name}</span>
                    <span>- NT$ {d.amount.toLocaleString()}</span>
                  </div>
                ))}
                {freeItemsList.map((g, i) => (
                  <div key={`gift-d-${i}`} className="flex justify-between text-emerald-700 font-medium">
                    <span>🎁 滿額贈：{g.name ?? g.sku ?? "贈品"} × {g.qty}</span>
                    <span>免費</span>
                  </div>
                ))}
                {memberDiscountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>👑 {promo?.tierName} {Math.round((promo?.memberDiscountRate ?? 0) * 100)}% off</span>
                    <span>- NT$ {memberDiscountAmount.toLocaleString()}</span>
                  </div>
                )}
                {couponDiscount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>🎟 優惠碼 {promo?.couponCode}</span>
                    <span>- NT$ {couponDiscount.toLocaleString()}</span>
                  </div>
                )}
                {pointsDiscount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>✨ 點數折抵（{promo?.pointsUsed} 點）</span>
                    <span>- NT$ {pointsDiscount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-zinc-500">
                  <span>運費（{SHIPPING_LABELS[shippingMethod]}）</span>
                  <span>{shippingFee === 0 ? (freeShippingByCampaign ? "活動免運" : "免運") : `NT$ ${shippingFee.toLocaleString()}`}</span>
                </div>
                <div className="flex justify-between font-bold text-lg pt-2 border-t">
                  <span>合計</span>
                  <span style={{ color: "#10305a" }}>NT$ {grandTotal.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
