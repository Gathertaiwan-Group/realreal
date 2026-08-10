import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    // next_order_number returns the 8-digit sequence string (migration 0045);
    // every other RPC in this route keeps the boolean-success shape.
    rpc: vi.fn().mockImplementation((fn: string) =>
      fn === "next_order_number"
        ? Promise.resolve({ data: "10000001", error: null })
        : Promise.resolve({ data: true, error: null })
    ),
  },
}))

vi.mock("../../lib/pchomepay", () => ({
  createPayment: vi.fn().mockResolvedValue({ paymentUrl: "https://sandbox.pchomepay.example/pay" }),
}))
vi.mock("../../lib/linepay", () => ({
  requestPayment: vi.fn().mockResolvedValue({ paymentUrl: "https://sandbox.linepay.example/pay", transactionId: "linepay-tx-1" }),
}))
vi.mock("../../lib/jkopay", () => ({
  initiatePayment: vi.fn().mockResolvedValue({ paymentUrl: "https://sandbox.jkopay.example/pay", merchantTradeNo: "jko-tx-1" }),
}))
vi.mock("../../lib/queue", () => ({
  inventoryQueue: { add: vi.fn() },
  invoiceQueue: { add: vi.fn() },
}))
vi.mock("../../lib/enqueue-post-payment", () => ({
  enqueuePostPaymentJobs: vi.fn(),
  notifyOrderPlacedCod: vi.fn(),
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

const validBody = {
  items: [
    {
      variantId: "a1b2c3d4-e5f6-4789-b012-c3d4e5f60001",
      qty: 1,
      unitPrice: 500,
    },
  ],
  address: {
    type: "shipping",
    name: "王小明",
    phone: "0912345678",
    addressType: "home",
    address: "重慶南路一段122號",
    city: "台北市",
    postalCode: "100",
  },
  shippingMethod: "home_delivery",
  paymentMethod: "pchomepay",
}

function makeMockChain(overrides: Record<string, any> = {}) {
  // Chain that is also a thenable — awaiting it resolves to { data: [], error: null }.
  // This lets queries terminate on any chainable method (e.g. `.in()`, `.or().or()`)
  // without needing each call site to add a custom mock.
  const chain: Record<string, any> = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: unknown[]; error: null; count?: number }) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    ...overrides,
  }
  return chain
}

describe("POST /orders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 201 with orderId on valid request", async () => {
    const orderRow = { id: "order-uuid-123", order_number: "RR1234567890" }

    let callCount = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "product_variants") {
        // Server now prices authoritatively from the catalog — variant must exist.
        return makeMockChain({
          then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
            resolve({
              data: [{
                id: "a1b2c3d4-e5f6-4789-b012-c3d4e5f60001",
                sku: "SKU1", name: "測試", price: 500, sale_price: null, addon_price: null,
                product_id: "p1", products: { category_id: null, name: "測試商品", is_addon: false },
              }],
              error: null,
            }),
        }) as any
      }
      if (table === "orders") {
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: orderRow, error: null }),
        } as any
      }
      if (table === "order_items") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        } as any
      }
      if (table === "order_addresses") {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        } as any
      }
      return makeMockChain() as any
    })

    const res = await request(app).post("/orders").send(validBody)
    if (res.status !== 201) console.error("[orders test] unexpected response:", res.status, JSON.stringify(res.body))
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty("data")
    expect(res.body.data).toHaveProperty("orderId", "order-uuid-123")
  })

  it("applies 加購價: splits the add-on line and discounts subtotal", async () => {
    // Cart: 1 normal item (is_addon:false, price 100) + 1 add-on variant
    // (is_addon:true, price 100, addon_price 80). The add-on's first unit is
    // charged 80; subtotal = 100 + 80 = 180. order_items must receive a single
    // addon row (qty1@80) plus the normal row.
    const orderRow = { id: "order-uuid-addon", order_number: "RR-ADDON" }
    const NORMAL_ID = "a1b2c3d4-e5f6-4789-b012-c3d4e5f60001"
    const ADDON_ID = "a1b2c3d4-e5f6-4789-b012-c3d4e5f60002"

    const orderItemsInsert = vi.fn().mockResolvedValue({ error: null })
    const ordersInsert = vi.fn().mockReturnThis()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "product_variants") {
        return makeMockChain({
          then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
            resolve({
              data: [
                {
                  id: NORMAL_ID,
                  sku: "SKU-N", name: "一般", price: 100, sale_price: null, addon_price: null,
                  product_id: "pn", products: { category_id: null, name: "一般商品", is_addon: false },
                },
                {
                  id: ADDON_ID,
                  sku: "SKU-A", name: "加購", price: 100, sale_price: null, addon_price: 80,
                  product_id: "pa", products: { category_id: null, name: "加購商品", is_addon: true },
                },
              ],
              error: null,
            }),
        }) as any
      }
      if (table === "orders") {
        return {
          insert: (...args: unknown[]) => { ordersInsert(...args); return {
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: orderRow, error: null }),
          } },
        } as any
      }
      if (table === "order_items") {
        return { insert: orderItemsInsert } as any
      }
      if (table === "order_addresses") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) } as any
      }
      return makeMockChain() as any
    })

    const body = {
      ...validBody,
      items: [
        { variantId: NORMAL_ID, qty: 1, unitPrice: 100 },
        { variantId: ADDON_ID, qty: 1, unitPrice: 100 },
      ],
    }
    const res = await request(app).post("/orders").send(body)
    if (res.status !== 201) console.error("[orders addon test] unexpected:", res.status, JSON.stringify(res.body))
    expect(res.status).toBe(201)

    // orders.subtotal reflects the add-on discount: 100 + 80 = 180.
    const ordersArg = ordersInsert.mock.calls[0][0] as { subtotal: number }
    expect(ordersArg.subtotal).toBe(180)

    // order_items receives the (split) expanded rows: normal qty1@100, addon qty1@80.
    const itemsArg = orderItemsInsert.mock.calls[0][0] as Array<{
      variant_id: string; qty: number; unit_price: number
    }>
    const addonRows = itemsArg.filter((r) => r.variant_id === ADDON_ID)
    expect(addonRows).toEqual([
      expect.objectContaining({ variant_id: ADDON_ID, qty: 1, unit_price: 80 }),
    ])
    const normalRows = itemsArg.filter((r) => r.variant_id === NORMAL_ID)
    expect(normalRows).toEqual([
      expect.objectContaining({ variant_id: NORMAL_ID, qty: 1, unit_price: 100 }),
    ])
  })

  it("returns 400 for empty items", async () => {
    const res = await request(app).post("/orders").send({ ...validBody, items: [] })
    expect(res.status).toBe(400)
  })

  it("returns 400 for empty phone", async () => {
    const res = await request(app)
      .post("/orders")
      .send({
        ...validBody,
        address: { ...validBody.address, phone: "" },
      })
    expect(res.status).toBe(400)
  })

  it("returns 400 for missing items", async () => {
    const { items: _items, ...bodyWithoutItems } = validBody
    const res = await request(app).post("/orders").send(bodyWithoutItems)
    expect(res.status).toBe(400)
  })
})

describe("GET /orders/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/orders/00000000-0000-0000-0000-000000000001")
    expect(res.status).toBe(401)
  })
})

describe("GET /orders", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/orders")
    expect(res.status).toBe(401)
  })
})
