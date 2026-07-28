import { describe, it, expect, vi } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

// recommended_product_ids elements are real products.id (UUID column), so
// fixture ids use valid UUID strings rather than "prod-1" style placeholders
// — matches the convention used in admin-kols.test.ts for the same column.
const PROD_1 = "11111111-1111-4111-8111-111111111111"
const PROD_2 = "22222222-2222-4222-8222-222222222222"

function mockKolRow(overrides: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "kol-1",
        slug: "clairelien",
        name: "Claire Lien",
        avatar_url: null,
        bio: null,
        instagram_handle: "@theclairelien",
        youtube_handle: null,
        tiktok_handle: null,
        coupons: null,
        recommended_product_ids: [],
        ...overrides,
      },
      error: null,
    }),
  }
}

describe("GET /kols/:slug — products", () => {
  it("returns products in recommended_product_ids order, dropping deactivated ones", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "kols") {
        return mockKolRow({ recommended_product_ids: [PROD_2, PROD_1] }) as any
      }
      if (table === "products") {
        // PROD_2 被下架，查不到 → 之後只剩 PROD_1
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({
            data: [
              { id: PROD_1, name: "商品一", slug: "product-1", description: null, category_id: null, images: [], is_active: true, is_featured: false, is_addon: false, display_priority: 0, created_at: new Date().toISOString(), min_tier_id: null },
            ],
            error: null,
          }),
        } as any
      }
      // product_variants — enrichProducts 用來算 min_price / total_stock
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [{ product_id: PROD_1, price: 100, sale_price: null, stock_qty: 5 }],
          error: null,
        }),
      } as any
    })

    const res = await request(app).get("/kols/clairelien")

    expect(res.status).toBe(200)
    expect(res.body.data.products).toHaveLength(1)
    expect(res.body.data.products[0].id).toBe(PROD_1)
    expect(res.body.data.products[0].min_price).toBe(100)
    // PROD_2 was dropped entirely — must not silently appear in any form.
    expect(res.body.data.products.some((p: { id: string }) => p.id === PROD_2)).toBe(false)
  })

  it("preserves recommended_product_ids order even when the DB returns rows in a different order", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "kols") {
        // Curated order is PROD_1 first, then PROD_2.
        return mockKolRow({ recommended_product_ids: [PROD_1, PROD_2] }) as any
      }
      if (table === "products") {
        // Simulate Supabase .in() NOT preserving input order — return PROD_2 first.
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({
            data: [
              { id: PROD_2, name: "商品二", slug: "product-2", description: null, category_id: null, images: [], is_active: true, is_featured: false, is_addon: false, display_priority: 0, created_at: new Date().toISOString(), min_tier_id: null },
              { id: PROD_1, name: "商品一", slug: "product-1", description: null, category_id: null, images: [], is_active: true, is_featured: false, is_addon: false, display_priority: 0, created_at: new Date().toISOString(), min_tier_id: null },
            ],
            error: null,
          }),
        } as any
      }
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [
            { product_id: PROD_1, price: 100, sale_price: null, stock_qty: 5 },
            { product_id: PROD_2, price: 200, sale_price: null, stock_qty: 3 },
          ],
          error: null,
        }),
      } as any
    })

    const res = await request(app).get("/kols/clairelien")

    expect(res.status).toBe(200)
    expect(res.body.data.products.map((p: { id: string }) => p.id)).toEqual([
      PROD_1,
      PROD_2,
    ])
  })

  it("returns an empty products array when recommended_product_ids is empty", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "kols") {
        return mockKolRow({
          id: "kol-2",
          slug: "armand",
          name: "Armand",
          instagram_handle: null,
          recommended_product_ids: [],
        }) as any
      }
      // Neither products nor product_variants should be queried when the
      // KOL has no recommended_product_ids — but return empty data if they are.
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      } as any
    })

    const res = await request(app).get("/kols/armand")

    expect(res.status).toBe(200)
    expect(res.body.data.products).toEqual([])
  })
})
