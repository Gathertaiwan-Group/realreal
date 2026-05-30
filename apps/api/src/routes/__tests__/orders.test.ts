import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
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
  const chain: Record<string, any> = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    limit: vi.fn().mockReturnThis(),
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

  it("returns 400 for empty items", async () => {
    const res = await request(app).post("/orders").send({ ...validBody, items: [] })
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid phone", async () => {
    const res = await request(app)
      .post("/orders")
      .send({
        ...validBody,
        address: { ...validBody.address, phone: "1234" },
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
