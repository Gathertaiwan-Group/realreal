import { beforeEach, describe, it, expect, vi } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

const mockVariant = {
  id: "var-1",
  product_id: "prod-1",
  sku: "PROB-001",
  name: "60粒裝",
  price: "699.00",
  sale_price: null,
  stock_qty: 50,
  weight: "0.150",
  attributes: { size: "60粒" },
}

describe("GET /products/:id/variants", () => {
  it("returns variants for a product", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [mockVariant], error: null }),
    } as any)

    const res = await request(app).get("/products/prod-1/variants")
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
  })
})

describe("PATCH /products/:id/variants/:variantId/stock", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .patch("/products/prod-1/variants/var-1/stock")
      .send({ delta: -1 })
    expect(res.status).toBe(401)
  })

  it("returns 403 for an authenticated non-admin (must be admin-gated)", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "cust-1", email: "c@example.com" } },
      error: null,
    } as any)
    // requireAdmin looks up the role → not admin → 403
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { role: "customer" }, error: null }),
    } as any)

    const res = await request(app)
      .patch("/products/prod-1/variants/var-1/stock")
      .set("Authorization", "Bearer faketoken")
      .send({ delta: -1 })
    expect(res.status).toBe(403)
  })
})

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "admin-1", email: "admin@example.com" } },
    error: null,
  } as never)
}

// requireAdmin looks up the role in user_profiles; writes hit product_variants.
function mockAdminWrite() {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "user_profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
      } as never
    }
    if (table === "product_variants") {
      return {
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { ...mockVariant }, error: null }),
      } as never
    }
    throw new Error(`Unexpected table ${table}`)
  })
}

describe("addon_price write validation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("accepts POST with a valid addon_price (80 <= price 100)", async () => {
    mockAdminWrite()
    const res = await request(app)
      .post("/products/prod-1/variants")
      .set("Authorization", "Bearer test-token")
      .send({ name: "加購規格", price: 100, addon_price: 80, stock_qty: 5 })
    expect(res.status).toBe(201)
  })

  it("rejects POST when addon_price > price (120 > 100) with 400", async () => {
    mockAdminWrite()
    const res = await request(app)
      .post("/products/prod-1/variants")
      .set("Authorization", "Bearer test-token")
      .send({ name: "加購規格", price: 100, addon_price: 120, stock_qty: 5 })
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body.error)).toContain("加購價不可高於原價")
  })

  it("accepts PUT with a valid addon_price (80 <= price 100)", async () => {
    mockAdminWrite()
    const res = await request(app)
      .put("/products/prod-1/variants/var-1")
      .set("Authorization", "Bearer test-token")
      .send({ price: 100, addon_price: 80 })
    expect(res.status).toBe(200)
  })

  it("rejects PUT when addon_price > price (120 > 100) with 400", async () => {
    mockAdminWrite()
    const res = await request(app)
      .put("/products/prod-1/variants/var-1")
      .set("Authorization", "Bearer test-token")
      .send({ price: 100, addon_price: 120 })
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body.error)).toContain("加購價不可高於原價")
  })
})
