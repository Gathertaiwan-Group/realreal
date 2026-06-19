import { describe, it, expect } from "vitest"
import {
  evalBuyXGetY,
  type CartItem,
  type EvaluatorContext,
} from "../campaigns-evaluator"

// scope:"all" short-circuits resolveScopeItems (no Supabase), so these are pure
// unit tests of the buy_x_get_y math — in particular the 限同品項 (same_item_only)
// enforcement that was previously missing (different products were wrongly
// combined into a "buy X get Y" group).

function item(product_id: string, unit_price: number, qty: number): CartItem {
  return {
    product_id,
    variant_id: `${product_id}-v`,
    category_id: "cat-1",
    sku: `${product_id}-sku`,
    name: product_id,
    unit_price,
    qty,
  }
}

function ctxWith(items: CartItem[]): EvaluatorContext {
  return {
    user: { id: "u1", tier_id: null, birthday: null },
    cart: {
      items,
      subtotal: items.reduce((s, i) => s + i.unit_price * i.qty, 0),
      shipping_fee: 0,
    },
  }
}

function campaign(config: Record<string, unknown>) {
  return {
    id: "camp-1",
    name: "買一送一 — 蛋白粉",
    type: "buy_x_get_y",
    is_active: true,
    starts_at: "2026-01-01T00:00:00Z",
    ends_at: null,
    tier_id: null,
    config,
  }
}

const BOGO = {
  buy_quantity: 1,
  get_quantity: 1,
  scope: "all",
  free_item_rule: "lowest_price",
  max_uses_per_order: 1,
}

describe("evalBuyXGetY — 限同品項 (same_item_only)", () => {
  it("does NOT combine two DIFFERENT products into a group when same_item_only=true", async () => {
    // 1×組合(1680) + 1×可可粉(370): neither product reaches buy+get = 2 units.
    const ctx = ctxWith([item("p-combo", 1680, 1), item("p-cocoa", 370, 1)])
    const r = await evalBuyXGetY(campaign({ ...BOGO, same_item_only: true }), ctx)
    expect(r.applied).toBe(false)
    expect(r.discount_amount ?? 0).toBe(0)
  })

  it("applies within ONE product when same_item_only=true (buy 2 of same → 1 free)", async () => {
    const ctx = ctxWith([item("p-cocoa", 370, 2)])
    const r = await evalBuyXGetY(campaign({ ...BOGO, same_item_only: true }), ctx)
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(370)
  })

  it("accepts same_item_only stored as the string \"true\"", async () => {
    const ctx = ctxWith([item("p-combo", 1680, 1), item("p-cocoa", 370, 1)])
    const r = await evalBuyXGetY(campaign({ ...BOGO, same_item_only: "true" }), ctx)
    expect(r.applied).toBe(false)
  })

  it("STILL aggregates across products when same_item_only=false (legacy behaviour preserved)", async () => {
    const ctx = ctxWith([item("p-combo", 1680, 1), item("p-cocoa", 370, 1)])
    const r = await evalBuyXGetY(campaign({ ...BOGO, same_item_only: false }), ctx)
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(370) // cheapest unit (cocoa) free
  })

  it("same_item_only=true caps free units by max_uses_per_order and frees the cheapest eligible", async () => {
    // Two products each qualify for 1 use, but max_uses_per_order=1 → only 1 freed,
    // and it must be the cheapest eligible unit (the 30 cocoa, not the 80 combo).
    const ctx = ctxWith([item("p-combo", 80, 2), item("p-cocoa", 30, 2)])
    const r = await evalBuyXGetY(
      campaign({ ...BOGO, same_item_only: true, max_uses_per_order: 1 }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(30)
  })
})
