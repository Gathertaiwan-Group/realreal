import { describe, it, expect, vi } from "vitest"

// resolveScopeItems → getCategoryIdBySlug queries Supabase for the category id.
// Stub the client so the specific_categories path resolves a slug → "cat-A"
// without real I/O (mirrors the vi.mock pattern in tier.test.ts). scope:"all"
// short-circuits before any query, so the buy_x_get_y tests never hit this.
vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "cat-A" }, error: null }),
    })),
  },
}))

import {
  evalBuyXGetY,
  evalBundle,
  type CartItem,
  type EvaluatorContext,
} from "../campaigns-evaluator"

// scope:"all" short-circuits resolveScopeItems (no Supabase), so these are pure
// unit tests of the buy_x_get_y math — in particular the 限同品項 (same_item_only)
// enforcement that was previously missing (different products were wrongly
// combined into a "buy X get Y" group).

function item(
  product_id: string,
  unit_price: number,
  qty: number,
  category_id = "cat-1",
): CartItem {
  return {
    product_id,
    variant_id: `${product_id}-v`,
    category_id,
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

// evalBundle is now scope-aware (適用範圍/指定分類) and async, but defaults scope
// to "all" so legacy rows stay whole-cart. These config-alias cases all omit
// scope → resolveScopeItems("all", …) short-circuits (no Supabase). The admin
// form reuses the buy_x_get_y branch and saves the free count as `get_quantity`
// (NOT `free_quantity`), so a bundle created/edited via the form must still apply.
function bundleCampaign(config: Record<string, unknown>) {
  return {
    id: "camp-bundle-1",
    name: "任選 3 件最便宜免費",
    type: "bundle",
    is_active: true,
    starts_at: "2026-01-01T00:00:00Z",
    ends_at: null,
    tier_id: null,
    config,
  }
}

describe("evalBundle — config.get_quantity (form alias for free_quantity)", () => {
  it("applies when config uses get_quantity (form alias) instead of free_quantity", async () => {
    // buy 2 + get 1 → cart of 3 units → cheapest (370) is freed.
    const ctx = ctxWith([item("p-combo", 1680, 2), item("p-cocoa", 370, 1)])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 2,
        get_quantity: 1, // form alias — no free_quantity present
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(370) // cheapest unit free
  })

  it("still applies when config uses the legacy free_quantity key", async () => {
    const ctx = ctxWith([item("p-combo", 1680, 2), item("p-cocoa", 370, 1)])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 2,
        free_quantity: 1, // legacy seeded key
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(370)
  })

  it("free_quantity wins when BOTH keys are present", async () => {
    // free_quantity:1 takes precedence over get_quantity:2 → only 1 unit freed.
    const ctx = ctxWith([item("p-a", 100, 2), item("p-b", 50, 2)])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 1,
        free_quantity: 1,
        get_quantity: 2,
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(50) // exactly one (cheapest) unit
  })

  it("frees the correct unit count with get_quantity > 1 (highest_price rule)", async () => {
    // buy 1 + get 2 (via get_quantity) → 2 most-expensive units freed: 1680 + 1680.
    const ctx = ctxWith([item("p-combo", 1680, 2), item("p-cocoa", 370, 1)])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 1,
        get_quantity: 2,
        free_item_rule: "highest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(1680 + 1680)
  })

  it("does NOT apply when total cart qty < buy + get", async () => {
    // Only 2 units present, needs buy(2)+get(1)=3.
    const ctx = ctxWith([item("p-combo", 1680, 2)])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 2,
        get_quantity: 1,
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(false)
    expect(r.discount_amount ?? 0).toBe(0)
  })
})

// 適用範圍/指定分類 — bundle must now honour scope + category_slug. Legacy rows
// (no scope) and scope:"all" stay whole-cart; specific_categories restricts both
// the qualifying threshold AND the freeable pool to the in-scope category.
describe("evalBundle — 適用範圍/指定分類 (scope + category_slug)", () => {
  it("legacy: scope absent → whole cart (backward compat)", async () => {
    // No scope key at all — defaults to "all", counts every item like before.
    // 3 units across two categories qualify for buy 2 + get 1; cheapest (50) freed.
    const ctx = ctxWith([
      item("p-a", 100, 2, "cat-A"),
      item("p-b", 50, 1, "cat-B"),
    ])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 2,
        get_quantity: 1,
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(50) // cheapest of the WHOLE cart
  })

  it("scope:\"all\" explicit → whole cart", async () => {
    const ctx = ctxWith([
      item("p-a", 100, 2, "cat-A"),
      item("p-b", 50, 1, "cat-B"),
    ])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 2,
        get_quantity: 1,
        scope: "all",
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(50)
  })

  it("specific_categories: only the in-scope category counts toward the threshold AND is freeable", async () => {
    // Mock resolves category_slug → "cat-A". The cart has 3 in-scope units
    // (cat-A) and 2 out-of-scope units (cat-B, far cheaper). buy 2 + get 1
    // must be satisfied by cat-A ALONE, and the freed unit must come from
    // cat-A (300) — never the cheaper cat-B (10), proving cat-B is excluded.
    const ctx = ctxWith([
      item("p-a", 300, 3, "cat-A"), // in scope
      item("p-b", 10, 2, "cat-B"), // out of scope — cheaper, must stay paid
    ])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 2,
        get_quantity: 1,
        scope: "specific_categories",
        category_slug: "supplements-A", // distinct slug → avoids cross-test cache bleed
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(300) // cheapest IN-SCOPE unit, not the 10 cat-B
  })

  it("specific_categories: does NOT apply when the in-scope category alone is short of buy + get", async () => {
    // Only 2 cat-A units; out-of-scope cat-B has plenty but must not count.
    // Needs buy 2 + get 1 = 3 within cat-A → no application.
    const ctx = ctxWith([
      item("p-a", 300, 2, "cat-A"), // in scope, only 2 units
      item("p-b", 10, 5, "cat-B"), // out of scope — ignored
    ])
    const r = await evalBundle(
      bundleCampaign({
        buy_quantity: 2,
        get_quantity: 1,
        scope: "specific_categories",
        category_slug: "supplements-B", // distinct slug → avoids cross-test cache bleed
        free_item_rule: "lowest_price",
      }),
      ctx,
    )
    expect(r.applied).toBe(false)
    expect(r.discount_amount ?? 0).toBe(0)
  })
})
