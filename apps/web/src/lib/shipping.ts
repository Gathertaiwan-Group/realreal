export type ShippingConfig = {
  fee_home_delivery: number;
  fee_cvs: number;
  free_threshold_home: number;
  free_threshold_cvs: number;
};

export const DEFAULT_SHIPPING: ShippingConfig = {
  fee_home_delivery: 100,
  fee_cvs: 80,
  free_threshold_home: 1000,
  free_threshold_cvs: 1000,
};

export function computeShippingClient(
  method: "home_delivery" | "711" | "family",
  subtotal: number,
  cfg: ShippingConfig = DEFAULT_SHIPPING,
): number {
  const isHome = method === "home_delivery";
  const fee = isHome ? cfg.fee_home_delivery : cfg.fee_cvs;
  const threshold = isHome ? cfg.free_threshold_home : cfg.free_threshold_cvs;
  if (threshold > 0 && subtotal >= threshold) return 0;
  return fee;
}
