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
      addon_price: 1200,
      addon_limit: 3,
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
    const select = vi.fn().mockReturnThis()
    const mockProductsQuery = {
      select,
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      textSearch: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [{
          ...mockProduct,
          product_variants: [{
            id: "variant-1",
            sku: "PROBIOTIC-30",
            name: "30 顆",
            price: 680,
            sale_price: 599,
            addon_price: 450,
            stock_qty: 12,
          }],
        }],
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
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("product_variants(id, sku, name, price, sale_price, addon_price, addon_limit, stock_qty)"),
      { count: "exact" },
    )
    expect(res.body.data[0].variants[0]).toMatchObject({
      id: "variant-1",
      price: 680,
      sale_price: 599,
      addon_price: 450,
      stock_qty: 12,
    })
  })

  it("filters by is_recommended when ?is_recommended=true", async () => {
    const eq = vi.fn().mockReturnThis()
    const mockProductsQuery = {
      select: vi.fn().mockReturnThis(),
      eq,
      is: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      textSearch: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
      order: vi.fn().mockReturnThis(),
    }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "product_variants") {
        return { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [], error: null }) } as any
      }
      return mockProductsQuery as any
    })

    const res = await request(app).get("/products?is_recommended=true")
    expect(res.status).toBe(200)
    expect(eq).toHaveBeenCalledWith("is_recommended", true)
  })
})

describe("PATCH /admin/products/:id/toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("accepts is_recommended and returns the updated flag", async () => {
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
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: "prod-1", is_active: true, is_addon: false, is_recommended: true },
            error: null,
          }),
        } as never
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .patch("/admin/products/prod-1/toggle")
      .set("Authorization", "Bearer test-token")
      .send({ is_recommended: true })

    expect(res.status).toBe(200)
    expect(res.body.data.is_recommended).toBe(true)
  })

  it("rejects an empty toggle payload", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as never
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .patch("/admin/products/prod-1/toggle")
      .set("Authorization", "Bearer test-token")
      .send({})

    expect(res.status).toBe(400)
  })
})

describe("GET /products/:slug", () => {
  it("returns 404 for unknown slug", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
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
    // addon_price (加購價) is accepted on a nested variant and flows through
    expect(res.body.data.variants[0].addon_price).toBe(1200)
    // addon_limit (加購數量上限) is accepted too
    expect(res.body.data.variants[0].addon_limit).toBe(3)
  })

  it("rejects a nested variant whose addon_price exceeds price", async () => {
    const res = await request(app)
      .post("/admin/products")
      .set("Authorization", "Bearer test-token")
      .send({
        ...nestedProductBody,
        variants: [
          { ...nestedProductBody.variants[0], price: 100, addon_price: 120 },
        ],
      })

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body.error)).toContain("加購價不可高於原價")
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

function mockUserProfilesAdmin() {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
  }
}

describe("DELETE /products/:id (soft delete)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("archives the product (deleted_at + is_active=false) and returns mode: archived", async () => {
    const updatePayloadSpy = vi.fn()
    // update().eq().is() resolves with no error
    const isFn = vi.fn().mockResolvedValue({ error: null })
    const eqFn = vi.fn().mockReturnValue({ is: isFn })
    const updateFn = vi.fn().mockImplementation((payload: unknown) => {
      updatePayloadSpy(payload)
      return { eq: eqFn }
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return mockUserProfilesAdmin() as never
      if (table === "products") return { update: updateFn } as never
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .delete("/products/prod-1")
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, mode: "archived" })
    // sets is_active=false and a deleted_at timestamp
    const payload = updatePayloadSpy.mock.calls[0][0]
    expect(payload.is_active).toBe(false)
    expect(payload.deleted_at).toBeTruthy()
    expect(eqFn).toHaveBeenCalledWith("id", "prod-1")
    expect(isFn).toHaveBeenCalledWith("deleted_at", null)
  })
})

describe("DELETE /products/:id?hard=true (hard delete)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("returns 409 when a variant is referenced by order_items", async () => {
    const productsDelete = vi.fn()
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return mockUserProfilesAdmin() as never
      if (table === "product_variants") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ id: "variant-1" }], error: null }),
        } as never
      }
      if (table === "order_items") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [{ id: "oi-1" }], error: null }),
        } as never
      }
      if (table === "subscription_plans") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as never
      }
      if (table === "products") {
        return { delete: productsDelete } as never
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .delete("/products/prod-1?hard=true")
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(409)
    expect(res.body.error).toContain("無法永久刪除")
    // must NOT delete the product
    expect(productsDelete).not.toHaveBeenCalled()
  })

  it("hard-deletes the product (mode: deleted) when no references exist", async () => {
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const productsDelete = vi.fn().mockReturnValue({ eq: deleteEq })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return mockUserProfilesAdmin() as never
      if (table === "product_variants") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ id: "variant-1" }], error: null }),
        } as never
      }
      if (table === "order_items") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as never
      }
      if (table === "subscription_plans") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as never
      }
      if (table === "products") {
        return { delete: productsDelete } as never
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .delete("/products/prod-1?hard=true")
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, mode: "deleted" })
    expect(deleteEq).toHaveBeenCalledWith("id", "prod-1")
  })
})

describe("POST /admin/products/:id/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("clears deleted_at and returns ok", async () => {
    const updatePayloadSpy = vi.fn()
    const eqFn = vi.fn().mockResolvedValue({ error: null })
    const updateFn = vi.fn().mockImplementation((payload: unknown) => {
      updatePayloadSpy(payload)
      return { eq: eqFn }
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return mockUserProfilesAdmin() as never
      if (table === "products") return { update: updateFn } as never
      throw new Error(`Unexpected table ${table}`)
    })

    const res = await request(app)
      .post("/admin/products/prod-1/restore")
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(updatePayloadSpy.mock.calls[0][0]).toEqual({ deleted_at: null })
    expect(eqFn).toHaveBeenCalledWith("id", "prod-1")
  })
})
