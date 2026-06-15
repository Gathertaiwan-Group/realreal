/**
 * Add-on price (加購價) DISPLAY helper.
 *
 * DISPLAY ONLY — the server (/orders/preview) is the authoritative price.
 * This mirrors the server's rule purely so the cart/drawer can show the
 * discounted add-on line. Never use these numbers to charge the customer.
 *
 * Server rule (mirrored here): an add-on item (isAddon && addonPrice != null
 * && addonPrice < price) is charged at addonPrice for the FIRST 1 unit, but
 * ONLY when the cart contains ≥1 normal (non-add-on) item. The remaining units
 * — and every unit when the cart has no normal item — use the normal price.
 */

export type AddonDisplayItem = {
  price: number
  qty: number
  isAddon?: boolean
  addonPrice?: number
}

export type AddonDisplayLine = {
  /** Effective unit price for the discounted (first) unit. */
  unitPrice: number
  /** Normal unit price for any remaining units. */
  restUnitPrice: number
  /** Number of units charged at the discounted unitPrice (0 or 1). */
  discountedQty: number
  /** Line total after applying the add-on display rule. */
  lineSubtotal: number
  /** True when the add-on discount actually applies to this line. */
  addonApplied: boolean
}

/** Whether this item is eligible for the add-on discount (ignoring cart state). */
function isEligibleAddon(item: AddonDisplayItem): boolean {
  return (
    item.isAddon === true &&
    item.addonPrice != null &&
    item.addonPrice < item.price
  )
}

/**
 * Apply the add-on display rule across the cart, returning one line result per
 * item (same order as the input). DISPLAY ONLY.
 */
export function applyAddonDisplay(
  items: AddonDisplayItem[],
): AddonDisplayLine[] {
  // The discount only kicks in when there's at least one normal item in the
  // cart (an item that is NOT an add-on).
  const hasNormalItem = items.some((i) => i.isAddon !== true)

  return items.map((item) => {
    const eligible = hasNormalItem && isEligibleAddon(item)
    if (!eligible || item.qty <= 0) {
      return {
        unitPrice: item.price,
        restUnitPrice: item.price,
        discountedQty: 0,
        lineSubtotal: item.price * Math.max(0, item.qty),
        addonApplied: false,
      }
    }
    // First 1 unit at addonPrice, the rest at the normal price.
    const addonPrice = item.addonPrice as number
    const discountedQty = 1
    const restQty = item.qty - discountedQty
    return {
      unitPrice: addonPrice,
      restUnitPrice: item.price,
      discountedQty,
      lineSubtotal: addonPrice * discountedQty + item.price * restQty,
      addonApplied: true,
    }
  })
}

/** Convenience: the cart subtotal with the add-on display rule applied. */
export function cartDisplaySubtotal(items: AddonDisplayItem[]): number {
  return applyAddonDisplay(items).reduce((sum, line) => sum + line.lineSubtotal, 0)
}
