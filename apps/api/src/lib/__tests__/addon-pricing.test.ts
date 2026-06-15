import { describe, it, expect } from "vitest"
import {
  computeAddonPricing,
  mergeItemsByVariant,
  type VariantPricingRow,
} from "../addon-pricing"

// Helper to build a VariantPricingRow with sensible defaults.
function variant(
  id: string,
  opts: {
    price?: number | string | null
    sale_price?: number | string | null
    addon_price?: number | string | null
    is_addon?: boolean | null
  } = {},
): VariantPricingRow {
  return {
    id,
    sku: `SKU-${id}`,
    name: `Variant ${id}`,
    price: opts.price ?? null,
    sale_price: opts.sale_price ?? null,
    addon_price: opts.addon_price ?? null,
    product_id: `prod-${id}`,
    products: {
      category_id: null,
      name: `Product ${id}`,
      is_addon: opts.is_addon ?? false,
    },
  }
}

function mapOf(...rows: VariantPricingRow[]): Map<string, VariantPricingRow> {
  return new Map(rows.map((r) => [r.id, r]))
}

describe("computeAddonPricing", () => {
  it("(1) eligible add-on + normal item → first unit @addon, rest @normal", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      variant("addon", { price: 100, addon_price: 80, is_addon: true }),
    )
    const items = [
      { variantId: "normal", qty: 1 },
      { variantId: "addon", qty: 3 },
    ]
    const { lines, expandedItems, subtotalCents } = computeAddonPricing(items, map)

    // normal: 200*100 = 20000 ; addon: 1@8000 + 2@10000 = 28000
    expect(subtotalCents).toBe(20000 + 8000 + 20000)

    const addonLine = lines.find((l) => l.variantId === "addon")!
    expect(addonLine.addonQty).toBe(1)
    expect(addonLine.addonUnitCents).toBe(8000)
    expect(addonLine.normalUnitCents).toBe(10000)

    // expanded: normal(qty1@20000), addon(qty1@8000), addon(qty2@10000)
    const addonExpanded = expandedItems.filter((e) => e.variantId === "addon")
    expect(addonExpanded).toEqual([
      { variantId: "addon", qty: 1, unitPriceCents: 8000 },
      { variantId: "addon", qty: 2, unitPriceCents: 10000 },
    ])
    expect(expandedItems.find((e) => e.variantId === "normal")).toEqual({
      variantId: "normal",
      qty: 1,
      unitPriceCents: 20000,
    })
  })

  it("(2) add-on present but NO qualifying normal item → all normal, single row", () => {
    const map = mapOf(variant("addon", { price: 100, addon_price: 80, is_addon: true }))
    const items = [{ variantId: "addon", qty: 2 }]
    const { lines, expandedItems, subtotalCents } = computeAddonPricing(items, map)

    expect(subtotalCents).toBe(20000) // 2 * 10000
    expect(lines[0].addonQty).toBe(0)
    expect(expandedItems).toEqual([{ variantId: "addon", qty: 2, unitPriceCents: 10000 }])
  })

  it("(3) is_addon=false but addon_price set → never discounted", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      // addon_price set, but product is NOT an add-on product
      variant("notaddon", { price: 100, addon_price: 80, is_addon: false }),
    )
    const items = [
      { variantId: "normal", qty: 1 },
      { variantId: "notaddon", qty: 1 },
    ]
    const { lines, subtotalCents } = computeAddonPricing(items, map)

    expect(subtotalCents).toBe(20000 + 10000)
    expect(lines.find((l) => l.variantId === "notaddon")!.addonQty).toBe(0)
  })

  it("(4) guard: addon_price >= normal effective price → normal", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      // addon_price equals normal price → not strictly less → no discount
      variant("addon", { price: 100, addon_price: 100, is_addon: true }),
    )
    const items = [
      { variantId: "normal", qty: 1 },
      { variantId: "addon", qty: 1 },
    ]
    const { lines, subtotalCents } = computeAddonPricing(items, map)

    expect(subtotalCents).toBe(20000 + 10000)
    expect(lines.find((l) => l.variantId === "addon")!.addonQty).toBe(0)
  })

  it("(5) addon_price null → normal", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      variant("addon", { price: 100, addon_price: null, is_addon: true }),
    )
    const items = [
      { variantId: "normal", qty: 1 },
      { variantId: "addon", qty: 1 },
    ]
    const { lines, subtotalCents } = computeAddonPricing(items, map)

    expect(subtotalCents).toBe(20000 + 10000)
    expect(lines.find((l) => l.variantId === "addon")!.addonQty).toBe(0)
  })

  it("(6) cart of only add-on products → all normal (no qualifying non-add-on item)", () => {
    const map = mapOf(
      variant("addonA", { price: 100, addon_price: 80, is_addon: true }),
      variant("addonB", { price: 50, addon_price: 30, is_addon: true }),
    )
    const items = [
      { variantId: "addonA", qty: 1 },
      { variantId: "addonB", qty: 2 },
    ]
    const { lines, subtotalCents } = computeAddonPricing(items, map)

    // No non-add-on item → nothing gets the add-on price.
    expect(subtotalCents).toBe(10000 + 2 * 5000)
    expect(lines.every((l) => l.addonQty === 0)).toBe(true)
  })

  it("(7) qty=1 eligible → single addon row, no remainder", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      variant("addon", { price: 100, addon_price: 80, is_addon: true }),
    )
    const items = [
      { variantId: "normal", qty: 1 },
      { variantId: "addon", qty: 1 },
    ]
    const { lines, expandedItems, subtotalCents } = computeAddonPricing(items, map)

    expect(subtotalCents).toBe(20000 + 8000)
    expect(lines.find((l) => l.variantId === "addon")!.addonQty).toBe(1)
    const addonExpanded = expandedItems.filter((e) => e.variantId === "addon")
    expect(addonExpanded).toEqual([{ variantId: "addon", qty: 1, unitPriceCents: 8000 }])
  })

  it("(8) sale_price lower than price → normal leg uses sale_price and guard compares against sale_price", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      // effective normal = sale_price 90 (9000c). addon_price 80 < 90 → eligible.
      variant("addon", { price: 100, sale_price: 90, addon_price: 80, is_addon: true }),
    )
    const items = [
      { variantId: "normal", qty: 1 },
      { variantId: "addon", qty: 2 },
    ]
    const { lines, expandedItems, subtotalCents } = computeAddonPricing(items, map)

    const addonLine = lines.find((l) => l.variantId === "addon")!
    expect(addonLine.normalUnitCents).toBe(9000) // sale_price, not price
    expect(addonLine.addonUnitCents).toBe(8000)
    expect(addonLine.addonQty).toBe(1)
    // addon: 1@8000 + 1@9000(sale) = 17000 ; normal: 20000
    expect(subtotalCents).toBe(20000 + 8000 + 9000)
    expect(expandedItems.filter((e) => e.variantId === "addon")).toEqual([
      { variantId: "addon", qty: 1, unitPriceCents: 8000 },
      { variantId: "addon", qty: 1, unitPriceCents: 9000 },
    ])
  })

  it("(8b) guard compares against sale_price: addon_price >= sale_price → normal", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      // sale_price 75 (7500c) < addon_price 80 (8000c) → NOT strictly less → normal.
      variant("addon", { price: 100, sale_price: 75, addon_price: 80, is_addon: true }),
    )
    const items = [
      { variantId: "normal", qty: 1 },
      { variantId: "addon", qty: 1 },
    ]
    const { lines, subtotalCents } = computeAddonPricing(items, map)

    expect(lines.find((l) => l.variantId === "addon")!.addonQty).toBe(0)
    expect(subtotalCents).toBe(20000 + 7500)
  })

  it("(9) two un-merged lines of the same add-on variant, after mergeItemsByVariant, only get ONE discounted unit", () => {
    const map = mapOf(
      variant("normal", { price: 200, is_addon: false }),
      variant("addon", { price: 100, addon_price: 80, is_addon: true }),
    )
    // Same add-on variant sent as two separate lines (qty 1 + qty 1).
    const rawItems = [
      { variantId: "normal", qty: 1 },
      { variantId: "addon", qty: 1 },
      { variantId: "addon", qty: 1 },
    ]
    const merged = mergeItemsByVariant(rawItems)
    expect(merged.find((m) => m.variantId === "addon")!.qty).toBe(2)

    const { lines, expandedItems, subtotalCents } = computeAddonPricing(merged, map)
    const addonLine = lines.find((l) => l.variantId === "addon")!
    expect(addonLine.addonQty).toBe(1) // only ONE unit discounted
    // addon: 1@8000 + 1@10000 = 18000 ; normal: 20000
    expect(subtotalCents).toBe(20000 + 8000 + 10000)
    expect(expandedItems.filter((e) => e.variantId === "addon")).toEqual([
      { variantId: "addon", qty: 1, unitPriceCents: 8000 },
      { variantId: "addon", qty: 1, unitPriceCents: 10000 },
    ])
  })
})

describe("mergeItemsByVariant", () => {
  it("sums qty per variant and preserves the first line's labels", () => {
    const items = [
      { variantId: "a", qty: 1, productName: "First A", variantName: "VA1" },
      { variantId: "b", qty: 2, productName: "B" },
      { variantId: "a", qty: 3, productName: "Second A", variantName: "VA2" },
    ]
    const merged = mergeItemsByVariant(items)
    expect(merged).toHaveLength(2)
    const a = merged.find((m) => m.variantId === "a")!
    expect(a.qty).toBe(4)
    // first line's labels win
    expect(a.productName).toBe("First A")
    expect(a.variantName).toBe("VA1")
    expect(merged.find((m) => m.variantId === "b")!.qty).toBe(2)
  })

  it("does not mutate the input items", () => {
    const items = [
      { variantId: "a", qty: 1 },
      { variantId: "a", qty: 2 },
    ]
    mergeItemsByVariant(items)
    expect(items[0].qty).toBe(1) // original untouched
  })
})
