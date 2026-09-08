/**
 * 這支工作會自己動手取消客人的訂單，所以「選誰」比「怎麼取消」更需要釘住。
 *
 * 三個絕對不能碰的：貨到付款（取貨前本來就是待付款）、通路商訂單
 * （payment_method 是 NULL、月結）、還有已經付款的訂單。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const filters: Record<string, unknown> = {}
const cancelSpy = vi.fn()

vi.mock("../../lib/supabase", () => {
  const builder: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    filters[`${name}:${String(args[0])}`] = args[1]
    return builder
  }
  Object.assign(builder, {
    select: record("select"),
    eq: record("eq"),
    neq: record("neq"),
    in: record("in"),
    is: record("is"),
    lt: record("lt"),
    order: record("order"),
    limit: vi.fn(() => Promise.resolve({ data: (globalThis as any).__rows ?? [], error: null })),
  })
  return { supabase: { from: vi.fn(() => builder) } }
})

vi.mock("../../lib/cancel-order", () => ({
  cancelOrderById: (...args: unknown[]) => {
    cancelSpy(...args)
    return Promise.resolve({ result: "cancelled", actions: {} })
  },
}))

vi.mock("bullmq", () => ({
  Queue: class { upsertJobScheduler() {} },
  Worker: class { on() {} },
}))
vi.mock("ioredis", () => ({ Redis: class {} }))
vi.mock("@sentry/node", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))

import { expireUnpaidOrders, cutoffIso, UNPAID_GRACE_HOURS } from "../expire-unpaid-orders"

beforeEach(() => {
  for (const k of Object.keys(filters)) delete filters[k]
  cancelSpy.mockClear()
  ;(globalThis as any).__rows = []
})

describe("逾期未付款自動取消：掃描範圍", () => {
  it("★ 只挑線上付款 —— 貨到付款與通路商（payment_method 為 NULL）都不在名單", async () => {
    await expireUnpaidOrders(new Date("2026-09-08T12:00:00Z"))
    expect(filters["in:payment_method"]).toEqual(["linepay", "jkopay", "pchomepay"])
    expect(filters["in:payment_method"]).not.toContain("cvs_cod")
  })

  it("★ 只挑零售訂單，不碰通路商", async () => {
    await expireUnpaidOrders(new Date("2026-09-08T12:00:00Z"))
    expect(filters["eq:order_type"]).toBe("retail")
  })

  it("★ 只挑待付款、且尚未付款的", async () => {
    await expireUnpaidOrders(new Date("2026-09-08T12:00:00Z"))
    expect(filters["eq:status"]).toBe("pending")
    expect(filters["neq:payment_status"]).toBe("paid")
  })

  it("★ 封存的訂單也要掃 —— 後台封存不會釋放首購資格", async () => {
    await expireUnpaidOrders(new Date("2026-09-08T12:00:00Z"))
    expect(filters).not.toHaveProperty("is:deleted_at")
  })

  it("★ 未滿 24 小時的不碰", () => {
    const now = new Date("2026-09-08T12:00:00Z")
    expect(UNPAID_GRACE_HOURS).toBe(24)
    expect(cutoffIso(now)).toBe("2026-09-07T12:00:00.000Z")
  })
})

describe("逾期未付款自動取消：執行", () => {
  it("★ 透過 cancelOrderById 取消，才會一併釋放首購資格與還原庫存", async () => {
    ;(globalThis as any).__rows = [
      { id: "o-1", order_number: "10000152", total: 1645, created_at: "2026-08-28T07:35:00Z" },
    ]
    const r = await expireUnpaidOrders(new Date("2026-09-08T12:00:00Z"))
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy.mock.calls[0][0]).toBe("o-1")
    expect(cancelSpy.mock.calls[0][2]).toEqual({ allowedStatuses: ["pending"] })
    expect(r).toMatchObject({ cancelled: 1, failed: 0, orderNumbers: ["10000152"] })
  })

  it("★ 單次最多 50 筆，超過的留到下一輪", async () => {
    ;(globalThis as any).__rows = Array.from({ length: 51 }, (_, i) => ({
      id: `o-${i}`,
      order_number: String(10000000 + i),
      total: 100,
      created_at: "2026-08-01T00:00:00Z",
    }))
    const r = await expireUnpaidOrders(new Date("2026-09-08T12:00:00Z"))
    expect(cancelSpy).toHaveBeenCalledTimes(50)
    expect(r.cappedAt).toBe(50)
  })

  it("沒有逾期訂單時什麼都不做", async () => {
    const r = await expireUnpaidOrders(new Date("2026-09-08T12:00:00Z"))
    expect(cancelSpy).not.toHaveBeenCalled()
    expect(r).toMatchObject({ found: 0, cancelled: 0 })
  })
})
