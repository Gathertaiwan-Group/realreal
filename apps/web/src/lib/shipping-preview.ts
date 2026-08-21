import type { CartItem } from "@/lib/cart"

export type CheckoutShippingMethod = "711" | "family" | "home_delivery" | "overseas_cod"
export type ApiShippingMethod = "cvs_711" | "cvs_family" | "home_delivery" | "overseas_cod"
export type CheckoutAddressType = "home" | "cvs" | "cvs_cod" | "overseas"

export interface OrderPreviewData {
  shipping: number
  free_shipping_names?: string[]
  total?: number
  shipping_rule?: {
    fee: number
    free_threshold: number
  }
}

export function toApiShippingMethod(method: CheckoutShippingMethod): ApiShippingMethod {
  if (method === "711") return "cvs_711"
  if (method === "family") return "cvs_family"
  return method
}

/**
 * ECPay 超商取貨 (UNIMARTC2C / FAMIC2C) rejects the ReceiverName unless it is
 * either 2~5 Chinese characters OR 4~10 Latin letters — no digits, spaces or
 * symbols (error 10500036). Mirror that rule at checkout so the customer fixes
 * the name BEFORE the order is placed, instead of the order silently failing
 * logistics creation. Returns an error message, or undefined when valid.
 *
 * 間隔號（·）is allowed for indigenous names. Kept identical to the server-side
 * guard in apps/api/src/lib/ecpay-name.ts — change both together.
 */
export function validateCvsReceiverName(raw: string): string | undefined {
  const n = raw.trim()
  if (!n) return "請輸入收件人姓名"
  const pureChinese = /^[一-龥·‧]{2,5}$/.test(n)
  const pureEnglish = /^[A-Za-z]{4,10}$/.test(n)
  if (!pureChinese && !pureEnglish) {
    return "超商取貨姓名須為中文 2~5 字，或英文 4~10 字（不可含數字、空白或符號）"
  }
  return undefined
}

/**
 * Business rule (not an ECPay constraint): reject single-word nicknames like
 * "xuan" so the recipient name entered at checkout actually matches what's
 * on their ID — otherwise 超商取貨 pickup gets refused at the counter.
 * Accepts a Chinese name (2~5 字) or an English full name — either spaced
 * ("Xuan Chen") or joined ("XuanChen", needed for CVS pickup where ECPay
 * rejects spaces). Kept identical to the server-side guard in
 * apps/api/src/lib/ecpay-name.ts (validateRealName) — change both together.
 */
export function validateRealName(raw: string): string | undefined {
  const n = raw.trim()
  if (!n) return "請輸入收件人姓名"
  const pureChinese = /^[一-龥·‧]{2,5}$/.test(n)
  if (pureChinese) return undefined
  const spacedFullName = /^[A-Za-z]{2,}(?:\s[A-Za-z]{2,}){1,3}$/.test(n)
  const joinedFullName = /^(?:[A-Z][a-z]{1,9}){2,4}$/.test(n)
  if (spacedFullName || joinedFullName) return undefined
  return "請輸入完整真實姓名（例如：王小明 / Xuan Chen），須與證件相同以利取貨，不接受暱稱"
}

export function buildOrderPreviewItems(items: CartItem[]) {
  return items.map((item) => ({
    variantId: item.variantId,
    qty: item.qty,
    unitPrice: Math.round(item.price * 100),
    productName: item.productName,
    variantName: item.variantName,
  }))
}

export function formatShippingPreviewLabel({
  preview,
  loading = false,
  fallbackLabel = "運費將於結帳時計算",
}: {
  preview: OrderPreviewData | null
  loading?: boolean
  fallbackLabel?: string
}) {
  if (preview) {
    if (preview.shipping === 0) {
      return (preview.free_shipping_names ?? []).length > 0 ? "活動免運" : "免運"
    }
    return `NT$ ${preview.shipping.toLocaleString()}`
  }
  if (loading) return "計算中…"
  return fallbackLabel
}

export function getFreeShippingProgress({
  subtotal,
  threshold,
}: {
  subtotal: number
  threshold: number
}) {
  if (threshold <= 0) {
    return { enabled: false, reached: false, remaining: 0, pct: 0 }
  }

  const reached = subtotal >= threshold
  const remaining = Math.max(0, threshold - subtotal)
  const pct = Math.min(100, Math.round((subtotal / threshold) * 100))
  return { enabled: true, reached, remaining, pct }
}
