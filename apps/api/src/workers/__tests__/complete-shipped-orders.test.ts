/**
 * 出貨滿 20 天自動結案。
 *
 * 重點在「什麼時候算出貨」：orders 沒有 shipped_at 欄位，出貨時間寫在 metadata，
 * 舊訂單沒有那一欄，只能退回 updated_at。退回的方向必須是「寧可晚、不可早」——
 * updated_at 只會比真正的出貨日晚，所以最壞情況是晚幾天結案。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const updates: Array<Record<string, unknown>> = []
const eqs: Array<[string, unknown]> = []

vi.mock("../../lib/supabase", () => {
  const builder: Record<string, unknown> = {}
  Object.assign(builder, {
    select: () => builder,
    eq: (...a: unknown[]) => {
      eqs.push([String(a[0]), a[1]])
      return builder
    },
    order: () => builder,
    limit: () => Promise.resolve({ data: (globalThis as any).__rows ?? [], error: null }),
    update: (patch: Record<string, unknown>) => {
      updates.push(patch)
      return {
        eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    },
  })
  return { supabase: { from: () => builder } }
})

vi.mock("bullmq", () => ({ Queue: class {}, Worker: class { on() {} } }))
vi.mock("ioredis", () => ({ Redis: class {} }))
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }))

import {
  completeShippedOrders,
  shippedAtOf,
  isDue,
  AUTO_COMPLETE_DAYS,
} from "../complete-shipped-orders"

const NOW = new Date("2026-09-30T00:00:00Z")

beforeEach(() => {
  updates.length = 0
  eqs.length = 0
  ;(globalThis as any).__rows = []
})

describe("出貨時間的判定", () => {
  it("★ 有 metadata.shipped_at 就用它", () => {
    const r = { updated_at: "2026-09-29T00:00:00Z", metadata: { shipped_at: "2026-09-01T00:00:00Z" } }
    expect(shippedAtOf(r).toISOString()).toBe("2026-09-01T00:00:00.000Z")
  })

  it("★ 舊訂單沒有那一欄，退回 updated_at", () => {
    const r = { updated_at: "2026-09-01T00:00:00Z", metadata: null }
    expect(shippedAtOf(r).toISOString()).toBe("2026-09-01T00:00:00.000Z")
  })

  it("metadata 裡的值壞掉時也退回 updated_at，不要當成 1970 年立刻結案", () => {
    const r = { updated_at: "2026-09-29T00:00:00Z", metadata: { shipped_at: "不是日期" } }
    expect(shippedAtOf(r).toISOString()).toBe("2026-09-29T00:00:00.000Z")
  })
})

describe("滿 20 天才結案", () => {
  it("設定值就是 20 天", () => {
    expect(AUTO_COMPLETE_DAYS).toBe(20)
  })

  it("★ 剛好滿 20 天：結案", () => {
    expect(isDue({ updated_at: "2026-09-10T00:00:00Z", metadata: null }, NOW)).toBe(true)
  })

  it("★ 差一小時滿 20 天：不動", () => {
    expect(isDue({ updated_at: "2026-09-10T01:00:00Z", metadata: null }, NOW)).toBe(false)
  })

  it("★ 出貨當天的訂單絕對不能被結案", () => {
    expect(isDue({ updated_at: NOW.toISOString(), metadata: null }, NOW)).toBe(false)
  })
})

describe("執行", () => {
  it("★ 只把到期的改成 completed，並寫入 completed_at", async () => {
    ;(globalThis as any).__rows = [
      { id: "a", order_number: "10000001", updated_at: "2026-09-01T00:00:00Z", metadata: null },
      { id: "b", order_number: "10000002", updated_at: "2026-09-29T00:00:00Z", metadata: null },
    ]
    const r = await completeShippedOrders(NOW)
    expect(r).toMatchObject({ checked: 2, completed: 1, failed: 0, orderNumbers: ["10000001"] })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ status: "completed" })
    expect(updates[0].completed_at).toBe(NOW.toISOString())
  })

  it("★ 只挑「已出貨」的訂單 —— 待付款、已取消的都不碰", async () => {
    await completeShippedOrders(NOW)
    expect(eqs).toContainEqual(["status", "shipped"])
  })

  it("沒有到期的就什麼都不做", async () => {
    ;(globalThis as any).__rows = [
      { id: "b", order_number: "10000002", updated_at: "2026-09-29T00:00:00Z", metadata: null },
    ]
    const r = await completeShippedOrders(NOW)
    expect(r.completed).toBe(0)
    expect(updates).toHaveLength(0)
  })
})
