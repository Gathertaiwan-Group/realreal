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
