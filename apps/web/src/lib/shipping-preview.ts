import type { CartItem } from "@/lib/cart"

export type CheckoutShippingMethod = "711" | "family" | "home_delivery" | "overseas_cod"
export type ApiShippingMethod = "cvs_711" | "cvs_family" | "home_delivery" | "overseas_cod"

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
