import { getSetting } from "./settings"

/**
 * Computes the shipping fee (in dollars) for a given shipping method and
 * subtotal, honoring runtime-editable settings:
 *
 *   shipping.fee_home_delivery / shipping.fee_cvs            — base fee
 *   shipping.free_threshold_home / shipping.free_threshold_cvs — free over X
 *
 * When the threshold is 0 (or unset), free shipping is disabled.
 */
export async function computeShipping(
  method: "home_delivery" | "cvs_711" | "cvs_family",
  subtotal: number,
): Promise<number> {
  const isHome = method === "home_delivery"
  const feeKey = isHome ? "shipping.fee_home_delivery" : "shipping.fee_cvs"
  const thresholdKey = isHome
    ? "shipping.free_threshold_home"
    : "shipping.free_threshold_cvs"

  const fee = Number((await getSetting(feeKey)) ?? "100")
  const threshold = Number((await getSetting(thresholdKey)) ?? "0")

  if (threshold > 0 && subtotal >= threshold) return 0
  return fee
}
