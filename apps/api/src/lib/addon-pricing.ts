export type VariantPricingRow = {
  id: string
  sku: string | null
  name: string
  price: number | string | null
  sale_price: number | string | null
  addon_price: number | string | null
  addon_limit: number | string | null
  product_id: string
  products: { category_id: string | null; name: string | null; is_addon: boolean | null } | null
}

export type AddonLinePricing = {
  variantId: string
  qty: number
  addonQty: number        // units charged at the add-on price (0..addon_limit)
  addonUnitCents: number
  normalUnitCents: number
}

export type ExpandedOrderItem = {
  variantId: string
  qty: number
  unitPriceCents: number
}

function normalUnitCents(v: VariantPricingRow): number {
  return Math.round(Number(v.sale_price ?? v.price ?? 0) * 100)
}

/**
 * Coalesce duplicate cart lines by variantId (sum qty), preserving the first
 * line's labels. MUST run before computeAddonPricing so the qty-1 add-on cap
 * can't be bypassed by sending the same variant as two separate lines.
 */
export function mergeItemsByVariant<T extends { variantId: string; qty: number }>(
  items: T[],
): T[] {
  const byVariant = new Map<string, T>()
  for (const it of items) {
    const cur = byVariant.get(it.variantId)
    if (cur) cur.qty += it.qty
    else byVariant.set(it.variantId, { ...it })
  }
  return [...byVariant.values()]
}

/**
 * Cart-aware effective pricing for the 加購價 feature. See feature rules.
 * Pass ALREADY-MERGED items (mergeItemsByVariant) so the qty cap is per-variant.
 */
export function computeAddonPricing(
  items: Array<{ variantId: string; qty: number }>,
  variantMap: Map<string, VariantPricingRow>,
): { lines: AddonLinePricing[]; expandedItems: ExpandedOrderItem[]; subtotalCents: number } {
  const hasNormalItem = items.some((i) => {
    const v = variantMap.get(i.variantId)
    return v != null && v.products?.is_addon !== true && i.qty >= 1
  })

  const lines: AddonLinePricing[] = []
  const expandedItems: ExpandedOrderItem[] = []
  let subtotalCents = 0

  for (const item of items) {
    const v = variantMap.get(item.variantId)
    const normal = v ? normalUnitCents(v) : 0
    const addonRaw = v?.addon_price != null ? Math.round(Number(v.addon_price) * 100) : null
    const isAddonProduct = v?.products?.is_addon === true
    const eligible = hasNormalItem && isAddonProduct && addonRaw != null && addonRaw < normal
    // Per-variant cap: the first `limit` units get the add-on price, the rest
    // fall back to the normal price. Defaults to 1 (legacy behaviour).
    const limit = Math.max(1, Math.floor(Number(v?.addon_limit ?? 1)))

    if (eligible && item.qty >= 1) {
      const addonQty = Math.min(item.qty, limit)
      lines.push({ variantId: item.variantId, qty: item.qty, addonQty, addonUnitCents: addonRaw!, normalUnitCents: normal })
      expandedItems.push({ variantId: item.variantId, qty: addonQty, unitPriceCents: addonRaw! })
      subtotalCents += addonRaw! * addonQty
      const rest = item.qty - addonQty
      if (rest > 0) {
        expandedItems.push({ variantId: item.variantId, qty: rest, unitPriceCents: normal })
        subtotalCents += normal * rest
      }
    } else {
      lines.push({ variantId: item.variantId, qty: item.qty, addonQty: 0, addonUnitCents: 0, normalUnitCents: normal })
      expandedItems.push({ variantId: item.variantId, qty: item.qty, unitPriceCents: normal })
      subtotalCents += normal * item.qty
    }
  }
  return { lines, expandedItems, subtotalCents }
}
