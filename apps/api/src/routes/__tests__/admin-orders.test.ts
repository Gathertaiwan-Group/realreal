import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  },
}))

// admin-orders.ts pulls in a handful of side-effect libs at module load. Stub
// them so importing the app never reaches out to ECPay / Amego / queues.
vi.mock("../../lib/enqueue-post-payment", () => ({ enqueuePostPaymentJobs: vi.fn() }))
vi.mock("../../lib/queue", () => ({
  inventoryQueue: { add: vi.fn() },
  invoiceQueue: { add: vi.fn() },
}))
vi.mock("../../lib/amego", () => ({ voidInvoice: vi.fn() }))
vi.mock("../../lib/ecpay-logistics", () => ({ cancelEcpayLogistics: vi.fn() }))
vi.mock("../../lib/refund-payment", () => ({ refundPayment: vi.fn() }))
vi.mock("../../lib/points", () => ({ refundOrderPoints: vi.fn(), refundPointsForOrder: vi.fn() }))
vi.mock("../../lib/tier", () => ({ decrementSpendOnRefund: vi.fn() }))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

const ORDER_ID = "00000000-0000-0000-0000-0000000000aa"

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "admin-1", email: "admin@example.com" } },
    error: null,
  } as never)
}

/**
 * Build a chainable + thenable query mock (mirrors orders.test.ts style).
 * `terminal` is what awaiting the chain (or its terminating .eq/.is/.delete)
 * resolves to; `single` is what .single() resolves to. Every chain method
 * returns `this` so arbitrary call orders work.
 */
function chain(opts: { terminal?: any; single?: any } = {}) {
  const terminal = opts.terminal ?? { data: [], error: null }
  const single = opts.single ?? { data: null, error: null }
  const c: Record<string, any> = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(single),
    maybeSingle: vi.fn().mockResolvedValue(single),
    then: (resolve: (v: any) => void) => resolve(terminal),
  }
  return c
}

/** Admin-auth gate always resolves to role=admin for user_profiles. */
function adminProfileChain() {
  return chain({ single: { data: { role: "admin" }, error: null } })
}

describe("DELETE /admin/orders/:id (soft / archive)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("stamps deleted_at and returns mode=archived", async () => {
    const update = vi.fn().mockReturnThis()
    const is = vi.fn().mockResolvedValue({ error: null })
    const eq = vi.fn().mockReturnValue({ is })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      if (table === "orders") return { update, eq } as any
      return chain() as any
    })

    const res = await request(app)
      .delete(`/admin/orders/${ORDER_ID}`)
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, mode: "archived" })
    // deleted_at set to a timestamp, scoped to the active (deleted_at IS NULL) row.
    const payload = update.mock.calls[0][0]
    expect(payload).toHaveProperty("deleted_at")
    expect(typeof payload.deleted_at).toBe("string")
    expect(eq).toHaveBeenCalledWith("id", ORDER_ID)
    expect(is).toHaveBeenCalledWith("deleted_at", null)
  })

  it("returns 500 when the soft-delete update errors", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      if (table === "orders") {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({ error: { message: "boom" } }),
        } as any
      }
      return chain() as any
    })

    const res = await request(app)
      .delete(`/admin/orders/${ORDER_ID}`)
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(500)
  })
})

describe("DELETE /admin/orders/:id?hard=true (guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("returns 409 when the order is paid", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      if (table === "orders") {
        return chain({
          single: { data: { id: ORDER_ID, status: "pending", payment_status: "paid" }, error: null },
        }) as any
      }
      if (table === "invoices") return chain({ terminal: { data: [], error: null } }) as any
      return chain() as any
    })

    const deleteSpy = vi.fn().mockReturnThis()
    const res = await request(app)
      .delete(`/admin/orders/${ORDER_ID}?hard=true`)
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(409)
    expect(res.body.error).toContain("無法永久刪除")
    // RPC (stock restore) must NOT run when we refuse.
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it("returns 409 when an issued invoice exists (even if unpaid + cancellable)", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      if (table === "orders") {
        return chain({
          single: { data: { id: ORDER_ID, status: "cancelled", payment_status: "pending" }, error: null },
        }) as any
      }
      if (table === "invoices") {
        return chain({ terminal: { data: [{ status: "issued" }], error: null } }) as any
      }
      return chain() as any
    })

    const res = await request(app)
      .delete(`/admin/orders/${ORDER_ID}?hard=true`)
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(409)
    expect(res.body.error).toContain("無法永久刪除")
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
})

describe("DELETE /admin/orders/:id?hard=true (execute)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("hard-deletes a pending unpaid order: restores stock, decrements coupon, deletes children + order", async () => {
    // A self-thenable query builder. select/update/delete record the op +
    // payload; eq/is/in continue the chain; single resolves a row. Awaiting the
    // builder (or its terminating eq) yields a configured per-op result. This
    // lets one table be queried, updated AND deleted within a single request —
    // exactly what the hard-delete path does to `orders` and `coupons`.
    type OpResults = {
      select?: any
      update?: any
      delete?: any
      single?: any
    }
    function builder(results: OpResults) {
      let op: keyof OpResults = "select"
      const b: any = {
        select: vi.fn(() => { op = "select"; return b }),
        update: vi.fn(() => { op = "update"; return b }),
        delete: vi.fn(() => { op = "delete"; return b }),
        insert: vi.fn(() => { op = "select"; return b }),
        eq: vi.fn(() => b),
        is: vi.fn(() => b),
        in: vi.fn(() => b),
        single: vi.fn().mockResolvedValue(results.single ?? { data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue(results.single ?? { data: null, error: null }),
        then: (resolve: (v: any) => void) =>
          resolve(results[op] ?? { data: [], error: null }),
      }
      return b
    }

    const ordersBuilder = builder({
      single: {
        data: { id: ORDER_ID, status: "pending", payment_status: "pending" },
        error: null,
      },
      update: { error: null }, // step 3 null invoice_id
      delete: { error: null }, // step 8 delete order
    })
    const couponsBuilder = builder({
      single: { data: { used_count: 3 }, error: null },
      update: { error: null },
    })
    const couponUsesBuilder = builder({
      select: { data: [{ id: "cu1", coupon_id: "coupon-1" }], error: null },
      delete: { error: null },
    })
    const invoicesBuilder = builder({ select: { data: [], error: null }, delete: { error: null } })
    const paymentsBuilder = builder({ delete: { error: null } })
    const logisticsBuilder = builder({ delete: { error: null } })
    const subBuilder = builder({ update: { error: null } })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      switch (table) {
        case "user_profiles":
          return adminProfileChain() as any
        case "orders":
          return ordersBuilder as any
        case "order_items":
          // restoreOrderStock reads these; return one line so the RPC fires.
          return chain({ terminal: { data: [{ variant_id: "v1", qty: 2 }], error: null } }) as any
        case "coupons":
          return couponsBuilder as any
        case "coupon_uses":
          return couponUsesBuilder as any
        case "invoices":
          return invoicesBuilder as any
        case "payments":
          return paymentsBuilder as any
        case "logistics":
          return logisticsBuilder as any
        case "subscription_orders":
          return subBuilder as any
        default:
          return chain() as any
      }
    })

    const res = await request(app)
      .delete(`/admin/orders/${ORDER_ID}?hard=true`)
      .set("Authorization", "Bearer test-token")

    if (res.status !== 200) console.error("[hard delete] unexpected:", res.status, JSON.stringify(res.body))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, mode: "deleted" })

    // Stock restore ran (pending order) → atomic_restore_stock RPC called.
    expect(supabase.rpc).toHaveBeenCalledWith("atomic_restore_stock", {
      p_variants: [{ id: "v1", qty: 2 }],
    })

    // Coupon used_count decremented 3 -> 2 (Math.max(0, 3-1)).
    expect(couponsBuilder.update).toHaveBeenCalledWith({ used_count: 2 })

    // coupon_uses removed for this order.
    expect(couponUsesBuilder.delete).toHaveBeenCalled()
    expect(couponUsesBuilder.eq).toHaveBeenCalledWith("order_id", ORDER_ID)

    // invoice_id nulled (step 3), invoices/payments/logistics deleted,
    // subscription_orders detached (step 7), then the order itself deleted.
    expect(ordersBuilder.update).toHaveBeenCalledWith({ invoice_id: null })
    expect(invoicesBuilder.delete).toHaveBeenCalled()
    expect(paymentsBuilder.delete).toHaveBeenCalled()
    expect(paymentsBuilder.eq).toHaveBeenCalledWith("order_id", ORDER_ID)
    expect(logisticsBuilder.delete).toHaveBeenCalled()
    expect(logisticsBuilder.eq).toHaveBeenCalledWith("order_id", ORDER_ID)
    expect(subBuilder.update).toHaveBeenCalledWith({ order_id: null })
    expect(ordersBuilder.delete).toHaveBeenCalled()
  })
})

describe("PATCH /admin/orders/:id/status → cancelled (coupon refund, bug B3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("decrements used_count via RPC and deletes coupon_uses when cancelling", async () => {
    // Order builder: the initial fetch (.select().eq().single()) returns a
    // non-cancelled, unpaid order; the status flip (.update().eq().select()
    // .single()) returns the updated row. Both share one chain.
    const ordersChain = chain({
      single: {
        data: {
          id: ORDER_ID,
          status: "processing",
          payment_status: "pending",
          total: 1000,
          updated_at: "2026-06-12T00:00:00.000Z",
          user_id: "user-1",
        },
        error: null,
      },
    })
    // coupon_uses: select().eq() yields one row; delete().eq() yields no error.
    const couponUsesChain = chain({
      terminal: { data: [{ id: "cu-1", coupon_id: "coupon-9" }], error: null },
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      if (table === "orders") return ordersChain as any
      if (table === "coupon_uses") return couponUsesChain as any
      // restoreOrderStock reads order_items — return none so the stock RPC is a no-op.
      if (table === "order_items") return chain({ terminal: { data: [], error: null } }) as any
      return chain() as any
    })

    const res = await request(app)
      .patch(`/admin/orders/${ORDER_ID}/status`)
      .set("Authorization", "Bearer test-token")
      .send({ status: "cancelled" })

    expect(res.status).toBe(200)
    // The coupon-usage rollback RPC fired with the order's coupon id.
    expect(supabase.rpc).toHaveBeenCalledWith("atomic_decrement_coupon_usage", {
      p_coupon_id: "coupon-9",
    })
    // The coupon_uses rows for this order were deleted (idempotency guard).
    expect(couponUsesChain.delete).toHaveBeenCalled()
    expect(couponUsesChain.eq).toHaveBeenCalledWith("order_id", ORDER_ID)
  })

  it("is a no-op (no RPC, no delete) when the order has no coupon_uses", async () => {
    const ordersChain = chain({
      single: {
        data: {
          id: ORDER_ID,
          status: "processing",
          payment_status: "pending",
          total: 1000,
          updated_at: "2026-06-12T00:00:00.000Z",
          user_id: "user-1",
        },
        error: null,
      },
    })
    // No coupon_uses rows for this order.
    const couponUsesChain = chain({ terminal: { data: [], error: null } })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      if (table === "orders") return ordersChain as any
      if (table === "coupon_uses") return couponUsesChain as any
      if (table === "order_items") return chain({ terminal: { data: [], error: null } }) as any
      return chain() as any
    })

    const res = await request(app)
      .patch(`/admin/orders/${ORDER_ID}/status`)
      .set("Authorization", "Bearer test-token")
      .send({ status: "cancelled" })

    expect(res.status).toBe(200)
    // No coupon to decrement → the rollback RPC must not fire, and nothing is deleted.
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "atomic_decrement_coupon_usage",
      expect.anything(),
    )
    expect(couponUsesChain.delete).not.toHaveBeenCalled()
  })
})

describe("POST /admin/orders/:id/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("clears deleted_at and returns ok", async () => {
    const update = vi.fn().mockReturnThis()
    const eq = vi.fn().mockResolvedValue({ error: null })
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      if (table === "orders") return { update, eq } as any
      return chain() as any
    })

    const res = await request(app)
      .post(`/admin/orders/${ORDER_ID}/restore`)
      .set("Authorization", "Bearer test-token")

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ deleted_at: null })
    expect(eq).toHaveBeenCalledWith("id", ORDER_ID)
  })
})
