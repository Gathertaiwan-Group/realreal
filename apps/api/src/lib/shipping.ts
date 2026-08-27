import { getSetting } from "./settings"

type ShippingMethod = "home_delivery" | "cvs_711" | "cvs_family" | "overseas_cod"

/**
 * Computes the shipping fee (in dollars) for a given shipping method and
 * subtotal, honoring runtime-editable settings:
 *
 *   shipping.fee_home_delivery / shipping.fee_cvs            — base fee
 *   shipping.free_threshold_home / shipping.free_threshold_cvs — free over X
 *
 * When the threshold is 0 (or unset), free shipping is disabled.
 */
export async function getShippingRule(
  method: ShippingMethod,
  paymentMethod?: string,
): Promise<{ fee: number; free_threshold: number }> {
  // 海外到付：運費由司機收取，線上顯示 0
  if (method === "overseas_cod") return { fee: 0, free_threshold: 0 }

  // 超商取貨付款（代收貨款）：使用專屬費率，滿專屬門檻同樣享免運
  if (
    (method === "cvs_711" || method === "cvs_family") &&
    paymentMethod === "cvs_cod"
  ) {
    const fee = Number((await getSetting("shipping.fee_cvs_cod")) ?? "80")
    const threshold = Number((await getSetting("shipping.free_threshold_cvs_cod")) ?? "999")
    return { fee, free_threshold: threshold }
  }

  const isHome = method === "home_delivery"
  const feeKey = isHome ? "shipping.fee_home_delivery" : "shipping.fee_cvs"
  const thresholdKey = isHome
    ? "shipping.free_threshold_home"
    : "shipping.free_threshold_cvs"

  const fee = Number((await getSetting(feeKey)) ?? "80")
  const threshold = Number((await getSetting(thresholdKey)) ?? "0")

  return { fee, free_threshold: threshold }
}

export async function computeShipping(
  method: ShippingMethod,
  subtotal: number,
  paymentMethod?: string,
): Promise<number> {
  const rule = await getShippingRule(method, paymentMethod)
  if (rule.free_threshold > 0 && subtotal >= rule.free_threshold) return 0
  return rule.fee
}
