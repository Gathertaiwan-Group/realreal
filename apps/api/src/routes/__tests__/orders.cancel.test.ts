import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: { from: vi.fn(), auth: { getUser: vi.fn() } },
}))
// Isolate the shared choreography — this suite verifies the member ENDPOINT
// contract (auth, ownership, status-gate mapping, response shape). The reversal
// itself lives in lib/cancel-order.ts.
vi.mock("../../lib/cancel-order", () => ({ cancelOrderById: vi.fn() }))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"
import { cancelOrderById } from "../../lib/cancel-order"

const OWNER = "user-1"

function authAs(userId: string) {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: userId, email: `${userId}@test.com` } },
    error: null,
  } as any)
}

// Ownership probe: supabase.from("orders").select("user_id").eq("id",…).single()
function mockOwnerOrder(ownerId: string | null) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "orders") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(
          ownerId === null
            ? { data: null, error: { message: "not found" } }
            : { data: { user_id: ownerId }, error: null },
        ),
      } as any
    }
    return {} as any
  })
}

const okActions = {
  invoice_void: { ok: true, message: "" },
  logistics_cancel: { ok: true, message: "" },
  payment_refund: { ok: true, message: "" },
  points_refund: { ok: true, message: "" },
  status_update: { ok: true, message: "" },
}

beforeEach(() => vi.clearAllMocks())

describe("POST /orders/:id/cancel (member self-cancel)", () => {
  it("401 without auth — never touches the cancel choreography", async () => {
    const res = await request(app).post("/orders/o1/cancel").send({})
    expect(res.status).toBe(401)
    expect(cancelOrderById).not.toHaveBeenCalled()
  })

  it("403 when the order belongs to someone else", async () => {
    authAs(OWNER)
    mockOwnerOrder("someone-else")
    const res = await request(app).post("/orders/o1/cancel").set("Authorization", "Bearer t").send({})
    expect(res.status).toBe(403)
    expect(cancelOrderById).not.toHaveBeenCalled()
  })

  it("404 when the order does not exist", async () => {
    authAs(OWNER)
    mockOwnerOrder(null)
    const res = await request(app).post("/orders/o1/cancel").set("Authorization", "Bearer t").send({})
    expect(res.status).toBe(404)
    expect(cancelOrderById).not.toHaveBeenCalled()
  })

  it("400 when not cancellable (already shipped)", async () => {
    authAs(OWNER)
    mockOwnerOrder(OWNER)
    vi.mocked(cancelOrderById).mockResolvedValue({
      result: "not_cancellable", orderStatus: "shipped", actions: okActions,
    } as any)
    const res = await request(app).post("/orders/o1/cancel").set("Authorization", "Bearer t").send({})
    expect(res.status).toBe(400)
  })

  it("200 + refunded:false for an unpaid order, gated to pending/processing", async () => {
    authAs(OWNER)
    mockOwnerOrder(OWNER)
    vi.mocked(cancelOrderById).mockResolvedValue({
      result: "cancelled", orderStatus: "pending", wasPaid: false, actions: okActions,
    } as any)
    const res = await request(app)
      .post("/orders/o1/cancel").set("Authorization", "Bearer t").send({ reason: "改變心意" })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.refunded).toBe(false)
    expect(cancelOrderById).toHaveBeenCalledWith("o1", "改變心意", {
      allowedStatuses: ["pending", "processing"],
    })
  })

  it("200 + refunded:true for a paid order; default reason when omitted", async () => {
    authAs(OWNER)
    mockOwnerOrder(OWNER)
    vi.mocked(cancelOrderById).mockResolvedValue({
      result: "cancelled", orderStatus: "processing", wasPaid: true, actions: okActions,
    } as any)
    const res = await request(app).post("/orders/o1/cancel").set("Authorization", "Bearer t").send({})
    expect(res.status).toBe(200)
    expect(res.body.refunded).toBe(true)
    expect(cancelOrderById).toHaveBeenCalledWith("o1", "會員自行取消", {
      allowedStatuses: ["pending", "processing"],
    })
  })
})
