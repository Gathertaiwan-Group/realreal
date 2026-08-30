"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useCart } from "@/lib/cart"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InvoiceSelector, type InvoiceData } from "@/components/checkout/InvoiceSelector"
import { API_URL } from "@/lib/api-url"
import { applyAddonDisplay, cartDisplaySubtotal } from "@/lib/addon-display"
import {
  buildOrderPreviewItems,
  formatShippingPreviewLabel,
  toApiShippingMethod,
  validateCvsReceiverName,
  validateRealName,
} from "@/lib/shipping-preview"
import {
  PromoWidget,
  readPromoState,
  PROMO_EVENT,
  type PromoState,
} from "@/components/checkout/PromoWidget"
import { MemberReminderCard } from "@/components/checkout/MemberReminderCard"
import {
  listUserAddresses,
  migrateLegacyAddresses,
  type UserAddress,
} from "@/lib/user-addresses"

type AddressType = "home" | "cvs" | "cvs_cod" | "overseas"
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

/**
 * Saved address book — written by /my-account (AccountSettingsSection).
 * Stored in localStorage (not the DB), keyed by browser. We read the default
 * entry to prefill the checkout form for returning customers.
 */
type SavedAddress = {
  id: string
  name: string
  phone: string
  city: string
  district: string
  postal_code: string
  address_line: string
  is_default: boolean
}

const ADDRESS_BOOK_KEY = "realreal_addresses"

const SHIPPING_LABELS: Record<ShippingMethod, string> = {
  "711": "7-11取貨",
  "family": "全家取貨",
  "home_delivery": "宅配",
  "overseas_cod": "港澳寄送（到付）",
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

// 驗證失敗時要捲到第一個有錯的欄位 —— 順序須照畫面由上而下。各 addressType 的
// 錯誤鍵互斥（home: city/address；cvs: cvsStore；overseas: country/address），
// 共用的 address 永遠排在 city/country 之後，所以單一順序即可正確涵蓋三種模式。
const CHECKOUT_ERROR_FIELD_ORDER: Array<keyof FieldErrors> = [
  "name",
  "phone",
  "email",
  "cvsStore",
  "city",
  "country",
  "address",
]
// 錯誤鍵 → DOM 元素 id（address 對應的 input id 是 addressLine；cvsStore 是門市
// 選擇器外層的錨點 div）。
const CHECKOUT_ERROR_ELEMENT_ID: Record<string, string> = {
  name: "name",
  phone: "phone",
  email: "email",
  city: "city",
  address: "addressLine",
  cvsStore: "cvs-store-section",
  country: "country",
}

function scrollToFirstError(errs: FieldErrors) {
  for (const key of CHECKOUT_ERROR_FIELD_ORDER) {
    if (!errs[key]) continue
    const el = document.getElementById(CHECKOUT_ERROR_ELEMENT_ID[key])
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    // 聚焦欄位讓使用者能直接輸入；preventScroll 避免瀏覽器的瞬間跳動蓋掉平滑捲動。
    // 門市選擇器是 div（不可聚焦），就只捲動不聚焦。
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      el.focus({ preventScroll: true })
    }
    return
  }
}

export default function CheckoutPage() {
  const router = useRouter()
  const items = useCart(s => s.items)
  const total = useCart(s => s.total)
  const updatePrice = useCart(s => s.updatePrice)
  const [hydrated, setHydrated] = useState(false)

  // Per-line addon pricing for the 訂單摘要 — mirrors CartDrawer so what the
  // user saw before clicking 結帳 is exactly what they see here. Without this,
  // each line renders item.price * item.qty (raw catalog price), making the
  // discount appear to "reset to 原價" between cart and checkout. The
  //商品小計 row uses preview?.subtotal (server-authoritative), but per-line
  // numbers need their own calculation. addonLines is index-aligned to items.
  const addonLines = useMemo(() => applyAddonDisplay(items), [items])

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
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // Account-bound saved address book (loaded for logged-in users in 2b).
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string>("")
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const didRunAddressTypeEffect = useRef(false)

  const searchParams = useSearchParams()

  // 1. Draft restore — must run BEFORE the URL-params useEffect so its setState
  //    doesn't get overwritten by the (potentially empty) post-redirect state.
  //    Only runs once on mount.
  useEffect(() => {
    // Fallback prefill from the saved address book (default entry). Skipped
    // when a valid CVS draft is restored — the draft already carries the
    // in-progress form state. Functional setState so it only fills empty
    // fields and never clobbers a draft or anything the user already typed.
    function prefillFromAddressBook() {
      try {
        const raw = localStorage.getItem(ADDRESS_BOOK_KEY)
        if (!raw) return
        const list = JSON.parse(raw) as SavedAddress[]
        if (!Array.isArray(list) || list.length === 0) return
        const def = list.find((a) => a.is_default) ?? list[0]
        if (!def) return
        if (def.name) setName((prev) => prev || def.name)
        if (def.phone) setPhone((prev) => prev || def.phone)
        if (def.city) setCity((prev) => prev || def.city)
        if (def.district) setDistrict((prev) => prev || def.district)
        if (def.postal_code) setPostalCode((prev) => prev || def.postal_code)
        if (def.address_line) setAddressLine((prev) => prev || def.address_line)
      } catch {
        // malformed address book → ignore
      }
    }

    const raw = typeof window !== "undefined" ? localStorage.getItem(CVS_DRAFT_KEY) : null
    if (!raw) {
      prefillFromAddressBook()
      return
    }
    try {
      const draft = JSON.parse(raw) as CvsDraft
      if (!draft || typeof draft.expiresAt !== "number" || Date.now() > draft.expiresAt) {
        localStorage.removeItem(CVS_DRAFT_KEY)
        prefillFromAddressBook()
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
      // bad json → fall through to cleanup + address book prefill
      prefillFromAddressBook()
    } finally {
      localStorage.removeItem(CVS_DRAFT_KEY)
    }
  }, [])

  // 2. Cart hydration
  useEffect(() => {
    useCart.persist.rehydrate()
    setHydrated(true)
  }, [])

  // 2a. Sync sale_price / originalPrice from the API so checkout always shows
  //     correct strikethrough prices even for stale localStorage cart items.
  useEffect(() => {
    if (!hydrated || items.length === 0) return
    const ids = items.map(i => i.variantId).join(",")
    fetch(`${API_URL}/variants/prices?ids=${ids}`)
      .then(r => r.ok ? r.json() : null)
      .then((json: { data?: { id: string; price: string; sale_price: string | null }[] } | null) => {
        if (!json?.data) return
        for (const v of json.data) {
          const ep = Number(v.sale_price ?? v.price)
          const op = Number(v.price)
          updatePrice(v.id, ep, op)
        }
      })
      .catch(() => {/* ignore */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

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
      setIsLoggedIn(!!user)
      if (!user) return

      if (user.email) setEmail((prev) => prev || user.email!)

      // Saved address book (account-bound). Migrate any legacy localStorage
      // entries into the backend first, then load + prefill the default.
      // Runs before the profile/order-history prefill so a saved default wins.
      await migrateLegacyAddresses()
      if (cancelled) return
      const addrs = await listUserAddresses()
      if (cancelled) return
      if (addrs.length > 0) {
        setSavedAddresses(addrs)
        const def = addrs.find((a) => a.is_default) ?? addrs[0]
        if (def) {
          setSelectedAddressId((prev) => prev || def.id)
          setName((prev) => prev || def.name)
          setPhone((prev) => prev || def.phone)
          setCity((prev) => prev || def.city)
          setDistrict((prev) => prev || def.district)
          setPostalCode((prev) => prev || def.postal_code)
          setAddressLine((prev) => prev || def.address_line)
        }
      }

      // Fetch profile fields for name / phone / tax_id prefill
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name, phone, tax_id")
        .eq("user_id", user.id)
        .maybeSingle()
      if (cancelled || !profile) return
      const p = profile as { display_name: string | null; phone: string | null; tax_id: string | null }
      if (p.display_name) setName((prev) => prev || p.display_name!)
      if (p.phone) setPhone((prev) => prev || p.phone!)
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
      // Functional setState so the saved address book (set synchronously on
      // mount) wins — order history only fills fields still empty.
      if (a.name) setName((prev) => prev || a.name!)
      if (a.phone) setPhone((prev) => prev || a.phone!)
      if (a.city) setCity((prev) => prev || a.city!)
      if (a.postal_code) setPostalCode((prev) => prev || a.postal_code!)
      if (a.address) setAddressLine((prev) => prev || a.address!)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Promo state lifted from step 2 — keeps coupon / points / member discount
  // visible BEFORE the user fills the address form. PromoWidget owns writes;
  // we just subscribe so the preview fetch + sidebar summary refresh. Declared
  // ABOVE the preview effect so that effect can fold the applied coupon/points
  // into POST /orders/preview, making preview.total the single authoritative
  // grand total (member + campaign + coupon + points all computed server-side).
  const [promo, setPromo] = useState<PromoState | null>(null)
  useEffect(() => {
    setPromo(readPromoState())
    const handler = () => setPromo(readPromoState())
    window.addEventListener(PROMO_EVENT, handler)
    return () => window.removeEventListener(PROMO_EVENT, handler)
  }, [])

  // 2c. Spec R Section 1 — call POST /orders/preview whenever cart or shipping
  //     changes so the summary can show 首購折抵 / 滿額贈品 / 等活動 lines BEFORE
  //     the user pays. Debounced 300ms.
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
    free_items: Array<{ sku?: string; product_id?: string; qty: number; name?: string; via_coupon?: boolean }>
    free_shipping_names: string[]
    total: number
  } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const itemsKey = useMemo(
    () => items.map(i => i.variantId + ":" + i.qty).sort().join("|"),
    [items],
  )
  // Applied coupon / points the user set via PromoWidget. Folding these into
  // the preview request makes preview.total the authoritative grand total
  // (server applies the same subtotal→tier→campaign→coupon→points precedence),
  // so the client never has to re-subtract any discount itself.
  const appliedCouponCode = promo?.couponApplied ? promo.couponCode : ""
  const appliedPointsUsed = promo?.pointsAllowed ? promo.pointsUsed : 0
  const promoPreviewKey = `${appliedCouponCode}:${appliedPointsUsed}`
  useEffect(() => {
    if (items.length === 0) {
      setPreview(null)
      setPreviewLoading(false)
      return
    }
    setPreview(null)
    setPreviewLoading(true)
    const t = setTimeout(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client")
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
            items: buildOrderPreviewItems(items),
            shippingMethod: toApiShippingMethod(shippingMethod),
            ...(addressType === "cvs_cod" ? { paymentMethodHint: "cvs_cod" } : {}),
            ...(appliedCouponCode ? { couponCode: appliedCouponCode } : {}),
            ...(appliedPointsUsed > 0 ? { points_used: appliedPointsUsed } : {}),
          }),
        })
        if (!res.ok) { setPreview(null); return }
        const json = await res.json()
        setPreview(json.data ?? null)
      } catch {
        setPreview(null)  // network blip: hide discount lines, keep raw total
      } finally {
        setPreviewLoading(false)
      }
    }, 300)
    return () => {
      clearTimeout(t)
      setPreviewLoading(false)
    }
    // items intentionally referenced via itemsKey for stable identity (T20).
    // appliedCoupon/Points referenced via promoPreviewKey for the same reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, shippingMethod, addressType, promoPreviewKey])

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
        setAddressType((prev) => (prev === "cvs_cod" ? "cvs_cod" : "cvs"))
      } else if (data.subType === "UNIMARTC2C") {
        setShippingMethod("711")
        setAddressType((prev) => (prev === "cvs_cod" ? "cvs_cod" : "cvs"))
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
      setAddressType((prev) => (prev === "cvs_cod" ? "cvs_cod" : "cvs"))
    } else if (subType === "UNIMARTC2C" || subType === "UNIMART") {
      setShippingMethod("711")
      setAddressType((prev) => (prev === "cvs_cod" ? "cvs_cod" : "cvs"))
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
    const isCollection = addressType === "cvs_cod" ? "Y" : "N"
    const url = `${API_URL}/logistics/map?logisticsSubType=${subType}&isCollection=${isCollection}`

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
  }, [shippingMethod, addressType, saveCvsDraft])

  // When switching to CVS, auto-select a CVS shipping method.
  // T8: only react to addressType changes — listening to shippingMethod here
  // would fight the user's manual selection (711 vs family).
  useEffect(() => {
    if (!didRunAddressTypeEffect.current) {
      didRunAddressTypeEffect.current = true
      return
    }

    if ((addressType === "cvs" || addressType === "cvs_cod") && shippingMethod === "home_delivery") {
      setShippingMethod("711")
    }
    if (addressType === "home" && shippingMethod !== "home_delivery") {
      setShippingMethod("home_delivery")
    }
    if (addressType === "overseas") {
      setShippingMethod("overseas_cod")
    }

    // Clear fields that don't belong to the newly-selected mode so they can't
    // leak into the persisted order address (T-P2). Going to a CVS mode drops
    // the street address; going to a non-CVS mode drops the picked store.
    if (addressType === "home" || addressType === "overseas") {
      setCvsStoreId("")
      setCvsStoreName("")
      setCvsAddress("")
    }
    if (addressType === "cvs" || addressType === "cvs_cod") {
      setAddressLine("")
      setPostalCode("")
      setDistrict("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressType])

  // Apply a saved address from the picker — overwrites the form fields since
  // the user explicitly chose it. "" = back to manual entry (leaves fields).
  function applySavedAddress(id: string) {
    setSelectedAddressId(id)
    if (!id) return
    const a = savedAddresses.find((x) => x.id === id)
    if (!a) return
    setName(a.name)
    setPhone(a.phone)
    setCity(a.city)
    setDistrict(a.district)
    setPostalCode(a.postal_code)
    setAddressLine(a.address_line)
    setErrors((prev) => ({ ...prev, name: undefined, phone: undefined, city: undefined, address: undefined }))
  }

  function validate(): FieldErrors {
    const errs: FieldErrors = {}
    if (!name.trim()) errs.name = "請輸入收件人姓名"
    else {
      const realNameErr = validateRealName(name)
      if (realNameErr) errs.name = realNameErr
    }
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
    } else if (addressType === "cvs" || addressType === "cvs_cod") {
      if (!cvsStoreName) errs.cvsStore = "請選擇取貨門市"
      // 超商取貨收件人姓名須符合綠界規則，否則訂單成立後會建單失敗
      if (name.trim() && !errs.name) {
        const cvsNameErr = validateCvsReceiverName(name)
        if (cvsNameErr) errs.name = cvsNameErr
      }
    } else {
      // overseas
      if (!country.trim()) errs.country = "請選擇地區（香港／澳門）"
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
    if (Object.keys(errs).length > 0) {
      // 捲動 + 聚焦到第一個有錯的欄位，使用者不用自己找哪裡紅字
      scrollToFirstError(errs)
      return
    }

    // Build the persisted address by addressType so residual fields from a
    // previously-selected mode never leak into the order (T-P2). Switching
    // home→cvs must not carry a street address; cvs→home must not carry a
    // store id; overseas keeps country but drops TW-only postal/district +
    // any store id. forcedPaymentMethod is only attached for cvs_cod, so it is
    // implicitly cleared when the user leaves cvs_cod.
    const baseAddress = { name, phone, email, addressType }
    const address =
      addressType === "home"
        ? { ...baseAddress, city, district, postalCode, addressLine }
        : addressType === "cvs" || addressType === "cvs_cod"
          ? { ...baseAddress, cvsStoreName, cvsStoreId }
          : // overseas
            { ...baseAddress, country, city, addressLine }

    const checkoutData = {
      items,
      address,
      shippingMethod,
      shippingFee: preview?.shipping ?? 0,
      invoice,
      notes: notes.trim() || undefined,
      ...(addressType === "cvs_cod" ? { forcedPaymentMethod: "cvs_cod" } : {}),
    }
    localStorage.setItem("realreal-checkout", JSON.stringify(checkoutData))
    router.push("/checkout/payment")
  }

  if (!hydrated) return null

  // Local subtotal fallback — used by 訂單摘要 when preview is still loading
  // OR when offline. Apply add-on display rule so the fallback matches the
  // per-line numbers (otherwise mobile shows lines NT$50 + NT$380 = NT$430
  // but 商品小計 NT$580 from the raw total() helper). preview.subtotal stays
  // authoritative once it arrives.
  const subtotal = cartDisplaySubtotal(items)
  // total() kept available for places that explicitly want the raw catalog
  // sum (none currently, but the hook stays exported).
  void total

  const shippingLabel = formatShippingPreviewLabel({ preview, loading: previewLoading })
  const discountLines = preview?.discounts ?? []
  const freeItemsList = preview?.free_items ?? []
  // A coupon-gated gift (e.g. "francis" → free 原味 sachet) isn't a
  // spend-threshold "滿額贈" — label it with the coupon so entering the code
  // visibly did something, instead of looking identical to a threshold gift.
  const giftLabel = (g: { via_coupon?: boolean }) =>
    g.via_coupon ? `🎁 ${promo?.couponCode || "優惠碼"}之友贈禮：` : "🎁 滿額贈："

  // The order SUMMARY total must be the server's authoritative number. The
  // preview request now carries the applied coupon/points, so preview.total
  // already has member + campaign + coupon + points subtracted server-side —
  // we display it verbatim and NEVER re-subtract a discount here (doing so
  // double-counted the member discount and showed less than we charge).
  //
  // Each discount LINE comes from the matching preview field so the breakdown
  // sums exactly to preview.total.
  //
  // Fallback (preview === null, e.g. network blip): fall back to the raw
  // subtotal minus the PromoWidget's own client-side estimates. This is a
  // best-effort display only — the real charge always comes from POST /orders.
  const memberDiscountAmount = preview
    ? preview.member_discount
    : promo
      ? Math.round(subtotal * promo.memberDiscountRate)
      : 0
  // Campaign discounts render as individual lines via `discountLines`
  // (preview.discounts[]); no separate scalar needed.
  const couponDiscount = preview
    ? preview.coupon_discount
    : promo?.couponApplied
      ? promo.couponDiscount
      : 0
  const pointsDiscount = preview
    ? preview.points_discount
    : promo?.pointsAllowed
      ? promo.pointsDiscount
      : 0
  const grandTotal = preview
    ? preview.total
    : Math.max(0, subtotal - memberDiscountAmount - couponDiscount - pointsDiscount)

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

              {!isLoggedIn && <MemberReminderCard />}

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
                    {touched.name && errors.name ? (
                      <p className="text-xs text-red-500">{errors.name}</p>
                    ) : (
                      <p className="text-xs text-zinc-500">提醒收件人姓名需與證件相同，以利取貨</p>
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(["home", "cvs", "cvs_cod", "overseas"] as AddressType[]).map(type => (
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
                        <span>{type === "home" ? "🏠" : type === "cvs" ? "🏪" : type === "cvs_cod" ? "💵" : "🌍"}</span>
                        <span>{type === "home" ? "宅配到府" : type === "cvs" ? "超商取貨" : type === "cvs_cod" ? "超商取貨付款" : "港澳寄送"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {addressType === "home" && (
                  <div className="space-y-3">
                    {savedAddresses.length > 0 && (
                      <div className="space-y-1.5">
                        <Label htmlFor="saved-address">選擇已存地址</Label>
                        <select
                          id="saved-address"
                          value={selectedAddressId}
                          onChange={e => applySavedAddress(e.target.value)}
                          className="flex h-10 w-full rounded-lg border-2 border-zinc-200 bg-white px-3 text-sm focus-visible:outline-none focus-visible:border-[#10305a]"
                        >
                          <option value="">＋ 手動輸入新地址</option>
                          {savedAddresses.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.name}｜{a.postal_code} {a.city}{a.district}{a.address_line}{a.is_default ? "（預設）" : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
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
                            <span className="text-sm text-zinc-500">
                              {value === shippingMethod ? shippingLabel : "選擇後計算"}
                            </span>
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
                            <span className="text-sm text-zinc-500">
                              {value === shippingMethod ? shippingLabel : "選擇後計算"}
                            </span>
                          </label>
                        ))}
                    </div>

                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      💡 全家偶有發生到貨漏未通知收件者的狀況，較建議選擇 7-11 取貨
                    </p>

                    {/* CVS Store Selector */}
                    <div id="cvs-store-section" className="rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-4">
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

                {addressType === "cvs_cod" && (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
                      💵 到超商取貨時當場以現金付款（代收貨款），不需要事先線上付款。
                    </div>
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
                            {/* COD：運費於取貨時隨貨款一併收取，這裡不顯示金額以免誤導 */}
                            <span className="text-sm text-zinc-500">
                              {value === shippingMethod ? "到店付款" : ""}
                            </span>
                          </label>
                        ))}
                    </div>

                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      💡 全家偶有發生到貨漏未通知收件者的狀況，較建議選擇 7-11 取貨
                    </p>

                    {/* CVS Store Selector */}
                    <div id="cvs-store-section" className="rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 p-4">
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
                    <p className="text-xs text-zinc-400">代收貨款服務費已含於運費，不提供免運優惠。</p>
                  </div>
                )}

                {addressType === "overseas" && (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                      📦 目前僅支援港澳地區，採順豐速運寄送。運費由司機收取，收到貨品時當場付款。商品金額請線上完成付款。
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>
                          地區 <span className="text-red-500">*</span>
                        </Label>
                        <div className="grid grid-cols-2 gap-2">
                          {(["香港", "澳門"] as const).map(region => (
                            <button
                              key={region}
                              type="button"
                              onClick={() => { setCountry(region); if (touched.country) setErrors(prev => ({ ...prev, country: undefined })) }}
                              className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors ${
                                country === region
                                  ? ""
                                  : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                              }`}
                              style={country === region ? { borderColor: "#10305a", backgroundColor: "rgba(16,48,90,0.05)", color: "#10305a" } : undefined}
                            >
                              {region}
                            </button>
                          ))}
                        </div>
                        {touched.country && errors.country && (
                          <p className="text-xs text-red-500">{errors.country}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="city">
                          地區細分（選填）
                        </Label>
                        <Input
                          id="city"
                          value={city}
                          onChange={e => setCity(e.target.value)}
                          placeholder="例：九龍 / 港島 / 新界"
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

              {/* Shipping packaging reminder */}
              <section className="space-y-2">
                <h2 className="text-lg font-semibold border-b pb-2">📦 出貨提醒</h2>
                <p className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  隨身包目前採散包出貨，不附紙盒。
                </p>
              </section>

              {/* Order notes */}
              <section className="space-y-4">
                <h2 className="text-lg font-semibold border-b pb-2">備註</h2>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">訂單備註（選填）</Label>
                  <textarea
                    id="notes"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    maxLength={500}
                    rows={3}
                    placeholder="例：自選口味組合——草莓 x 2、可可 x 1、杏仁火龍果 x 1"
                    className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  />
                  <p className="text-xs text-zinc-400">{notes.length}/500</p>
                </div>
              </section>

              {/* Mobile-only order summary */}
              <section className="lg:hidden space-y-3">
                <h2 className="text-lg font-semibold border-b pb-2">訂單摘要</h2>
                <div className="rounded-lg border divide-y">
                  {items.map((item, i) => {
                    const line = addonLines[i]
                    const addonApplied = line?.addonApplied ?? false
                    const lineSubtotal = line?.lineSubtotal ?? item.price * item.qty
                    // Original line total for the strikethrough: prefer addon-pre
                    // (full catalog price × qty) when add-on applied; else fall
                    // back to the existing sale_price-vs-price strikethrough.
                    const originalLineTotal = addonApplied
                      ? item.price * item.qty
                      : item.originalPrice && item.originalPrice > item.price
                        ? item.originalPrice * item.qty
                        : null
                    return (
                      <div key={item.variantId} className="flex items-center justify-between p-3">
                        <div>
                          <p className="font-medium text-sm">{item.productName}</p>
                          <p className="text-xs text-zinc-500">
                            {item.variantName} x {item.qty}
                            {addonApplied && (
                              <span className="ml-2 inline-flex items-center rounded bg-[#10305a]/10 px-1 py-0.5 text-[10px] font-medium text-[#10305a]">加購價</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-sm" style={{ color: "#10305a" }}>NT$ {lineSubtotal.toLocaleString()}</p>
                          {originalLineTotal != null && (
                            <p className="text-xs line-through" style={{ color: "#687279" }}>NT$ {originalLineTotal.toLocaleString()}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  <div className="p-3 space-y-1 text-sm">
                    <div className="flex justify-between text-zinc-500">
                      <span>商品小計</span>
                      <span>NT$ {(preview?.subtotal ?? subtotal).toLocaleString()}</span>
                    </div>
                    {discountLines.map(d => (
                      <div key={d.campaign_id} className="flex justify-between text-emerald-700">
                        <span>{d.name}</span>
                        <span>- NT$ {d.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    {freeItemsList.map((g, i) => (
                      <div key={`gift-m-${i}`} className="flex justify-between text-emerald-700">
                        <span>{giftLabel(g)}{g.name ?? g.sku ?? "贈品"} × {g.qty}</span>
                        <span>免費</span>
                      </div>
                    ))}
                    {memberDiscountAmount > 0 && (
                      <div className="flex justify-between text-emerald-700">
                        <span>👑 {promo?.tierName ?? "會員"} {Math.round((promo?.memberDiscountRate ?? 0) * 100)}% off</span>
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
                        <span>✨ 點數折抵（{(promo?.pointsUsed ?? preview?.points_used ?? 0).toLocaleString()} 點）</span>
                        <span>- NT$ {pointsDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-zinc-500">
                      <span>運費</span>
                      <span>{shippingLabel}</span>
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
                  disabled={items.length === 0 || previewLoading}
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
                {items.map((item, i) => {
                  const line = addonLines[i]
                  const addonApplied = line?.addonApplied ?? false
                  const lineSubtotal = line?.lineSubtotal ?? item.price * item.qty
                  const originalLineTotal = addonApplied
                    ? item.price * item.qty
                    : item.originalPrice && item.originalPrice > item.price
                      ? item.originalPrice * item.qty
                      : null
                  return (
                    <div key={item.variantId} className="flex justify-between py-2.5 text-sm">
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="font-medium truncate">{item.productName}</p>
                        <p className="text-xs text-zinc-500">
                          {item.variantName} x {item.qty}
                          {addonApplied && (
                            <span className="ml-1.5 inline-flex items-center rounded bg-[#10305a]/10 px-1 py-0.5 text-[10px] font-medium text-[#10305a]">加購價</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium whitespace-nowrap" style={{ color: "#10305a" }}>NT$ {lineSubtotal.toLocaleString()}</p>
                        {originalLineTotal != null && (
                          <p className="text-xs line-through whitespace-nowrap" style={{ color: "#687279" }}>NT$ {originalLineTotal.toLocaleString()}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="border-t pt-3 space-y-2 text-sm">
                <div className="flex justify-between text-zinc-500">
                  <span>商品小計</span>
                  <span>NT$ {(preview?.subtotal ?? subtotal).toLocaleString()}</span>
                </div>
                {discountLines.map(d => (
                  <div key={d.campaign_id} className="flex justify-between text-emerald-700 font-medium">
                    <span>{d.name}</span>
                    <span>- NT$ {d.amount.toLocaleString()}</span>
                  </div>
                ))}
                {freeItemsList.map((g, i) => (
                  <div key={`gift-d-${i}`} className="flex justify-between text-emerald-700 font-medium">
                    <span>{giftLabel(g)}{g.name ?? g.sku ?? "贈品"} × {g.qty}</span>
                    <span>免費</span>
                  </div>
                ))}
                {memberDiscountAmount > 0 && (
                  <div className="flex justify-between text-emerald-700 font-medium">
                    <span>👑 {promo?.tierName ?? "會員"} {Math.round((promo?.memberDiscountRate ?? 0) * 100)}% off</span>
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
                    <span>✨ 點數折抵（{(promo?.pointsUsed ?? preview?.points_used ?? 0).toLocaleString()} 點）</span>
                    <span>- NT$ {pointsDiscount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between text-zinc-500">
                  <span>運費（{SHIPPING_LABELS[shippingMethod]}）</span>
                  <span>{shippingLabel}</span>
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
