import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

// Module mocks — must be hoisted before importing the app.
vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    // restoreOrderStock + refundCouponUsage (step 5 of the choreography) call
    // supabase.rpc directly.
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

vi.mock("../src/lib/amego", () => ({
  voidInvoice: vi.fn(),
}))

vi.mock("../src/lib/ecpay-logistics", () => ({
  cancelEcpayLogistics: vi.fn(),
}))

vi.mock("../src/lib/refund-payment", () => ({
  refundPayment: vi.fn(),
}))

vi.mock("../src/lib/points", () => ({
  refundOrderPoints: vi.fn(),
}))

// The tier spend-mirror decrement is a separate concern with its own suite
// (src/lib/__tests__/tier.test.ts). Stub just that export — keeping the rest of
// the module real, since other routes mounted on `app` import from it — so this
// suite stays focused on the cancel choreography.
vi.mock("../src/lib/tier", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decrementSpendOnRefund: vi.fn(),
}))

import { app } from "../src/app"
import { supabase } from "../src/lib/supabase"
import { voidInvoice } from "../src/lib/amego"
import { cancelEcpayLogistics } from "../src/lib/ecpay-logistics"
import { refundPayment } from "../src/lib/refund-payment"
import { refundOrderPoints } from "../src/lib/points"
import { decrementSpendOnRefund } from "../src/lib/tier"

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "user-admin"
const ORDER_ID = "00000000-0000-0000-0000-000000000abc"

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: ADMIN_USER_ID, email: "admin@test.com" } },
    error: null,
  } as never)
}

interface OrderFixture {
  status?: string
  payment_status?: string | null
  payment_method?: string | null
  total?: number | string | null
  gateway_tx_id?: string | null
  user_id?: string | null
  invoices?:
    | Array<{ id: string; status: string | null; amego_id: string | null }>
    | { id: string; status: string | null; amego_id: string | null }
    | null
  logistics?:
    | Array<{
        id: string
        status: string | null
        type: string | null
        ecpay_logistics_id: string | null
        delivered_at: string | null
        raw_response: Record<string, unknown> | null
      }>
    | null
}

/**
 * Wires `supabase.from(table)` per-table. Used to compose per-test fixtures
 * without rewriting the full middleware + cancel-route mock chain each time.
 *
 * Captures the invoices/logistics/orders update calls so tests can assert
 * the cancelled status flip happened with the right payload.
 */
function setupSupabaseMocks(
  order: OrderFixture = {},
  opts: { orderItemsThrows?: boolean } = {},
) {
  const orderRow = {
    id: ORDER_ID,
    user_id: order.user_id === undefined ? "user-customer-1" : order.user_id,
    status: order.status ?? "processing",
    payment_status: order.payment_status ?? "paid",
    payment_method: order.payment_method ?? "pchomepay",
    total: order.total ?? 1000,
    gateway_tx_id: order.gateway_tx_id ?? "tx-1",
    invoices:
      order.invoices === undefined
        ? [
            {
              id: "inv-1",
              status: "issued",
              amego_id: "AB12345678",
            },
          ]
        : order.invoices,
    logistics:
      order.logistics === undefined
        ? [
            {
              id: "log-1",
              status: "in_transit",
              type: "CVS",
              ecpay_logistics_id: "L123",
              delivered_at: null,
              raw_response: { MerchantTradeNo: "MTN1" },
            },
          ]
        : order.logistics,
  }

  // Capture .update() payloads for assertions
  const invoiceUpdates: Array<Record<string, unknown>> = []
  const logisticsUpdates: Array<Record<string, unknown>> = []
  const orderUpdates: Array<Record<string, unknown>> = []

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "user_profiles") {
      // requireAdmin middleware — single() returns admin role
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
      } as never
    }
    if (table === "orders") {
      // Two ways orders is hit: the initial fetch (.select().eq().single())
      // and the final status flip (.update().eq() — no .single()).
      return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          orderUpdates.push(payload)
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: orderRow, error: null }),
      } as never
    }
    if (table === "invoices") {
      return {
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          invoiceUpdates.push(payload)
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      } as never
    }
    if (table === "logistics") {
      return {
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          logisticsUpdates.push(payload)
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          }
        }),
      } as never
    }
    if (table === "order_items") {
      // restoreOrderStock: .select("variant_id, qty").eq("order_id", …)
      return {
        select: vi.fn().mockReturnValue({
          eq: opts.orderItemsThrows
            ? vi.fn().mockImplementation(() => {
                throw new TypeError("order_items unavailable")
              })
            : vi.fn().mockResolvedValue({
                data: [{ variant_id: "var-1", qty: 2 }],
                error: null,
              }),
        }),
      } as never
    }
    if (table === "coupon_uses") {
      // refundCouponUsage: .select("id, coupon_id").eq(…) then .delete().eq(…)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: "cu-1", coupon_id: "coupon-1" }],
            error: null,
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      } as never
    }
    return {} as never
  })

  return { invoiceUpdates, logisticsUpdates, orderUpdates }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default happy-path returns — individual tests can override.
  vi.mocked(voidInvoice).mockResolvedValue({ code: 0 } as never)
  vi.mocked(cancelEcpayLogistics).mockResolvedValue({
    ok: true,
    message: "OK",
    raw: "1|OK",
  })
  vi.mocked(refundPayment).mockResolvedValue({
    ok: true,
    message: "已標記退款請求，請至金流後台手動操作",
  })
  // Spec Section 7 step 5 — points_refund. Default to a successful claw-back
  // so the happy-path case shows actions.points_refund.ok=true. Individual
  // tests override to assert the throw branch.
  vi.mocked(refundOrderPoints).mockResolvedValue({
    earned_reverted: 50,
    redeemed_returned: 30,
  })
  vi.mocked(decrementSpendOnRefund).mockResolvedValue({
    decremented: true,
    total_spend_delta: 1000,
    period_spend_delta: 1000,
    charity_delta: 0,
  })
  // Step 5 RPCs (atomic_restore_stock / atomic_decrement_coupon_usage).
  vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)
})

// ---------------------------------------------------------------------------
// POST /admin/orders/:id/cancel
// Spec: docs/superpowers/specs/2026-05-30-order-state-transitions-and-cancellation.md
// Section 5 — Testing
// ---------------------------------------------------------------------------

describe("POST /admin/orders/:id/cancel", () => {
  describe("case 1 — happy path: all four steps succeed", () => {
    it("returns 200 with all four actions ok=true", async () => {
      mockAdminAuth()
      const { invoiceUpdates, logisticsUpdates, orderUpdates } =
        setupSupabaseMocks()

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "客戶要求取消" })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        ok: true,
        actions: {
          invoice_void: { ok: true, message: "已作廢 Amego 發票" },
          logistics_cancel: { ok: true, message: "綠界物流已取消" },
          payment_refund: {
            ok: true,
            message: "已標記退款請求，請至金流後台手動操作",
          },
          points_refund: {
            ok: true,
            message: "返還 30 點、扣除 50 點回饋",
          },
          status_update: { ok: true, message: "訂單狀態已標記取消" },
        },
      })
      // Explicit per-spec expectation: refundOrderPoints returns ok:true on
      // the happy path, with the message reflecting the returned counts.
      expect(res.body.actions.points_refund).toEqual({
        ok: true,
        message: "返還 30 點、扣除 50 點回饋",
      })
      expect(refundOrderPoints).toHaveBeenCalledWith(
        ORDER_ID,
        "user-customer-1",
      )

      // Each external side-effect was called with the right input
      expect(voidInvoice).toHaveBeenCalledWith("AB12345678", "客戶要求取消")
      expect(cancelEcpayLogistics).toHaveBeenCalledWith(
        expect.objectContaining({
          ecpay_logistics_id: "L123",
          type: "CVS",
        }),
      )
      expect(refundPayment).toHaveBeenCalledWith(
        expect.objectContaining({ id: ORDER_ID, payment_method: "pchomepay" }),
        "客戶要求取消",
      )

      // DB updates: invoice voided, logistics cancelled, order flipped to
      // cancelled + refunded (because payment_status was 'paid').
      expect(invoiceUpdates[0]).toMatchObject({
        status: "voided",
        error_message: null,
      })
      expect(logisticsUpdates[0]).toMatchObject({ status: "cancelled" })
      expect(orderUpdates[0]).toMatchObject({
        status: "cancelled",
        payment_status: "refunded",
        cancel_reason: "客戶要求取消",
      })

      // Step 5 rides on the back of a successful status flip: reserved stock
      // goes back and the coupon use stops counting against max_uses.
      expect(supabase.rpc).toHaveBeenCalledWith("atomic_restore_stock", {
        p_variants: [{ id: "var-1", qty: 2 }],
      })
      expect(supabase.rpc).toHaveBeenCalledWith("atomic_decrement_coupon_usage", {
        p_coupon_id: "coupon-1",
      })
    })
  })

  describe("case 2 — voidInvoice throws", () => {
    it("returns 200 with invoice_void.ok=false; other three still succeed", async () => {
      mockAdminAuth()
      setupSupabaseMocks()
      vi.mocked(voidInvoice).mockRejectedValue(new Error("Amego 503"))

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "test" })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.actions.invoice_void).toEqual({
        ok: false,
        message: "Amego 503",
      })
      // The other three steps still ran independently
      expect(res.body.actions.logistics_cancel.ok).toBe(true)
      expect(res.body.actions.payment_refund.ok).toBe(true)
      expect(res.body.actions.status_update.ok).toBe(true)
    })
  })

  describe("case 3 — cancelEcpayLogistics returns ok=false", () => {
    it("returns 200 with logistics_cancel.ok=false; other three still succeed", async () => {
      mockAdminAuth()
      setupSupabaseMocks()
      vi.mocked(cancelEcpayLogistics).mockResolvedValue({
        ok: false,
        message: "物流商已收件",
        raw: "0|物流商已收件",
      })

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "test" })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.actions.logistics_cancel.ok).toBe(false)
      expect(res.body.actions.logistics_cancel.message).toContain(
        "綠界拒絕",
      )
      expect(res.body.actions.logistics_cancel.message).toContain(
        "物流商已收件",
      )
      // Independent steps still landed
      expect(res.body.actions.invoice_void.ok).toBe(true)
      expect(res.body.actions.payment_refund.ok).toBe(true)
      expect(res.body.actions.status_update.ok).toBe(true)
    })
  })

  describe("case 4 — order.status='completed'", () => {
    it("returns 400 'status=completed 不可取消'", async () => {
      mockAdminAuth()
      setupSupabaseMocks({ status: "completed" })

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "too late" })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe("status=completed 不可取消")
      // None of the side-effects should have run
      expect(voidInvoice).not.toHaveBeenCalled()
      expect(cancelEcpayLogistics).not.toHaveBeenCalled()
      expect(refundPayment).not.toHaveBeenCalled()
    })
  })

  describe("case 5 — order.status='pending' (unpaid)", () => {
    it("payment_refund.ok=true with '未付款，無需退款'", async () => {
      mockAdminAuth()
      // pending + payment_status=pending → no refund step
      setupSupabaseMocks({
        status: "pending",
        payment_status: "pending",
        // No logistics yet for a pending order
        logistics: null,
      })

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "客戶後悔" })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.actions.payment_refund).toEqual({
        ok: true,
        message: "未付款，無需退款",
      })
      // refundPayment must NOT be called for unpaid orders
      expect(refundPayment).not.toHaveBeenCalled()
      // status flip still fires
      expect(res.body.actions.status_update.ok).toBe(true)
    })
  })

  describe("case 6 — invoice doesn't exist", () => {
    it("invoice_void.ok=true with '無發票需作廢'", async () => {
      mockAdminAuth()
      setupSupabaseMocks({ invoices: null })

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "test" })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.actions.invoice_void).toEqual({
        ok: true,
        message: "無發票需作廢",
      })
      // voidInvoice must NOT be called when there's no invoice
      expect(voidInvoice).not.toHaveBeenCalled()
      // The other three still run
      expect(res.body.actions.logistics_cancel.ok).toBe(true)
      expect(res.body.actions.payment_refund.ok).toBe(true)
      expect(res.body.actions.status_update.ok).toBe(true)
    })
  })

  // Spec Section 7 — step 5 (points-refund) is independent of the other
  // four. A throw must surface as actions.points_refund.ok=false but the
  // other four still run.
  describe("case 7 — refundOrderPoints throws", () => {
    it("returns 200 with points_refund.ok=false; other four steps still succeed", async () => {
      mockAdminAuth()
      setupSupabaseMocks()
      vi.mocked(refundOrderPoints).mockRejectedValue(
        new Error("points table down"),
      )

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "test" })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.actions.points_refund).toEqual({
        ok: false,
        message: "points table down",
      })
      // The other four steps still ran independently
      expect(res.body.actions.invoice_void.ok).toBe(true)
      expect(res.body.actions.logistics_cancel.ok).toBe(true)
      expect(res.body.actions.payment_refund.ok).toBe(true)
      expect(res.body.actions.status_update.ok).toBe(true)
    })
  })

  // Regression guard for the bug this suite exposed the moment it was finally
  // wired into vitest. restoreOrderStock / refundCouponUsage are documented
  // non-fatal ("logs and continues"), but they used to sit INSIDE the
  // status_update try/catch — so a throw escaping either one overwrote the
  // already-set { ok: true, "訂單狀態已標記取消" } with { ok: false, <error> },
  // telling the admin the cancellation had failed when the orders row had in
  // fact already been flipped to cancelled/refunded and committed.
  describe("case 8 — a non-fatal step-5 helper throws after the status flip", () => {
    it("still reports status_update.ok=true, because the flip did land", async () => {
      mockAdminAuth()
      const { orderUpdates } = setupSupabaseMocks({}, { orderItemsThrows: true })

      const res = await request(app)
        .post(`/admin/orders/${ORDER_ID}/cancel`)
        .set("Authorization", "Bearer valid-token")
        .send({ reason: "test" })

      expect(res.status).toBe(200)
      // The orders row really was flipped to cancelled …
      expect(orderUpdates[0]).toMatchObject({
        status: "cancelled",
        payment_status: "refunded",
      })
      // … so the admin must be told that, not a stock-restore error.
      expect(res.body.actions.status_update).toEqual({
        ok: true,
        message: "訂單狀態已標記取消",
      })
      // The other four steps are untouched by the step-5 failure.
      expect(res.body.actions.invoice_void.ok).toBe(true)
      expect(res.body.actions.logistics_cancel.ok).toBe(true)
      expect(res.body.actions.payment_refund.ok).toBe(true)
      expect(res.body.actions.points_refund.ok).toBe(true)
    })
  })
})
