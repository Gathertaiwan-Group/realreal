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

const mockProduct = {
  id: "prod-1",
  name: "益生菌膠囊",
  slug: "probiotic-capsule",
  description: "每日益生菌補充",
  category_id: "cat-1",
  images: [],
  is_active: true,
  created_at: new Date().toISOString(),
}

const nestedProductBody = {
  product: {
    name: "30 天植物蛋白組",
    slug: "protein-30-pack",
    category_id: null,
    excerpt: "<p>摘要</p>",
    description: "<p>描述</p>",
    images: [],
    is_active: true,
    is_featured: true,
    is_addon: false,
    display_priority: 10,
  },
  variants: [
    {
      name: "30 包",
      sku: "PROTEIN-30",
      price: 1680,
      sale_price: 1499,
      stock_qty: 20,
      weight: 900,
      attributes: { 包數: "30" },
    },
  ],
}

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "admin-1", email: "admin@example.com" } },
    error: null,
  } as never)
}

describe("GET /products", () => {
  it("returns paginated products", async () => {
    const mockProductsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      textSearch: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [mockProduct],
        error: null,
        count: 1,
      }),
      order: vi.fn().mockReturnThis(),
    }
    const mockVariantsQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ product_id: "prod-1", price: 100, stock_qty: 10 }],
        error: null,
      }),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "product_variants") return mockVariantsQuery as any
      return mockProductsQuery as any
    })

    const res = await request(app).get("/products?page=1&limit=20")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
    expect(res.body).toHaveProperty("total")
  })
})

describe("GET /products/:slug", () => {
  it("returns 404 for unknown slug", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
    } as any)

    const res = await request(app).get("/products/nonexistent-slug")
    expect(res.status).toBe(404)
  })
})

describe("POST /products", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/products")
      .send({ name: "New Product", slug: "new-product" })
    expect(res.status).toBe(401)
  })
})

describe("POST /admin/products", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("creates a product and all variants", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as never
      }
      if (table === "products") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "product-1", ...nestedProductBody.product },
            error: null,
          }),
        } as never
      }
      if (table === "product_variants") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({
            data: [{ id: "variant-1", product_id: "product-1", ...nestedProductBody.variants[0] }],
            error: null,
          }),
        } as never
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .post("/admin/products")
      .set("Authorization", "Bearer test-token")
      .send(nestedProductBody)

    expect(res.status).toBe(201)
    expect(res.body.data.product.id).toBe("product-1")
    expect(res.body.data.variants).toHaveLength(1)
  })

  it("rejects duplicate SKUs before writing", async () => {
    const res = await request(app)
      .post("/admin/products")
      .set("Authorization", "Bearer test-token")
      .send({
        ...nestedProductBody,
        variants: [
          nestedProductBody.variants[0],
          { ...nestedProductBody.variants[0], name: "另一規格", sku: "protein-30" },
        ],
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain("Duplicate SKU")
    expect(vi.mocked(supabase.from).mock.calls).toEqual([["user_profiles"]])
  })

  it("deletes the product when variant insertion fails", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as never
      }
      if (table === "products") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "product-rollback", ...nestedProductBody.product },
            error: null,
          }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        } as never
      }
      if (table === "product_variants") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "variant insert failed" },
          }),
        } as never
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .post("/admin/products")
      .set("Authorization", "Bearer test-token")
      .send(nestedProductBody)

    expect(res.status).toBe(500)
    expect(deleteEq).toHaveBeenCalledWith("id", "product-rollback")
  })
})
