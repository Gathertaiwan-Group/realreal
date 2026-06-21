import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

const mockCategories = [
  { id: "cat-1", name: "保健品", slug: "supplements", parent_id: null, sort_order: 1 },
  { id: "cat-2", name: "益生菌", slug: "probiotics", parent_id: "cat-1", sort_order: 1 },
]

describe("GET /categories", () => {
  function mockSupabase(products: Array<{ category_id: string }>) {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "products") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: products, error: null }),
        } as any
      }
      // categories
      return {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockCategories, error: null }),
      } as any
    })
  }

  it("returns category tree", async () => {
    mockSupabase([])
    const res = await request(app).get("/categories")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
    expect(Array.isArray(res.body.data)).toBe(true)
  })

  it("includes product_count (active products) so the storefront can hide empty categories", async () => {
    // one active product in cat-1, none in cat-2
    mockSupabase([{ category_id: "cat-1" }])
    const res = await request(app).get("/categories")
    expect(res.status).toBe(200)
    const root = res.body.data.find((c: { id: string }) => c.id === "cat-1")
    expect(root.product_count).toBe(1)
    const child = root.children.find((c: { id: string }) => c.id === "cat-2")
    expect(child.product_count).toBe(0)
  })
})

describe("POST /categories", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/categories")
      .send({ name: "New Category", slug: "new-cat" })
    expect(res.status).toBe(401)
  })
})
