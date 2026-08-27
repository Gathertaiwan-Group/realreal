import { getSetting } from "./settings"

type ShippingMethod = "home_delivery" | "cvs_711" | "cvs_family" | "overseas_cod"

/**
 * Taiwan has no DST, so UTC+8 is a constant offset — no timezone library
 * needed. `now` is injectable so tests can pin a specific day instead of
 * depending on the real clock.
 */
export function isTaiwanWednesday(now: Date = new Date()): boolean {
  const taiwanMs = now.getTime() + 8 * 60 * 60 * 1000
  return new Date(taiwanMs).getUTCDay() === 3 // 0=Sun … 3=Wed
}

/**
 * Computes the shipping fee (in dollars) for a given shipping method and
 * subtotal, honoring runtime-editable settings:
 *
 *   shipping.fee_home_delivery / shipping.fee_cvs            — base fee
 *   shipping.free_threshold_home / shipping.free_threshold_cvs — free over X
 *
 * When the threshold is 0 (or unset), free shipping is disabled.
 *
 * Every Wednesday (Taiwan time), plain 超商取貨 (not COD, not home delivery)
 * gets a standing lower threshold — shipping.free_threshold_cvs_wed,
 * defaulting to 499 — instead of the everyday shipping.free_threshold_cvs.
 */
export async function getShippingRule(
  method: ShippingMethod,
  paymentMethod?: string,
  now: Date = new Date(),
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
  let threshold = Number((await getSetting(thresholdKey)) ?? "0")

  if (!isHome && isTaiwanWednesday(now)) {
    threshold = Number((await getSetting("shipping.free_threshold_cvs_wed")) ?? "499")
  }

  return { fee, free_threshold: threshold }
}

export async function computeShipping(
  method: ShippingMethod,
  subtotal: number,
  paymentMethod?: string,
  now: Date = new Date(),
): Promise<number> {
  const rule = await getShippingRule(method, paymentMethod, now)
  if (rule.free_threshold > 0 && subtotal >= rule.free_threshold) return 0
  return rule.fee
}
