/**
 * 生日禮金：一年限用一次。
 *
 * 原本 evalBirthdayBonus 只檢查「有沒有生日」和「在不在視窗內」，沒有任何次數
 * 限制 —— campaigns 沒有 max_uses/max_uses_per_user（那是 coupons 的欄位），而
 * 訂單上的 applied_campaign_ids 只是記錄、從來沒被回頭檢查。結果是 31 天的視窗
 * 內每下一筆單就折一次：同心之友回購 5 次就是 5 × 150。
 *
 * 幸好上線至今沒有任何訂單套用過生日禮金，所以政策是在零曝險的情況下定的。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))
vi.mock("../supabase", () => ({ supabase: { from: fromMock } }))

import { evalBirthdayBonus } from "../campaigns-evaluator"

const CAMPAIGN = {
  id: "camp-bday-50",
  name: "初心之友生日禮金50元",
  type: "birthday_bonus",
  config: {
    discount_method: "fixed",
    discount_value: 50,
    rebate_multiplier: 1,
    birthday_window_days: 31,
  },
} as never

// 2026-03-20，生日 3/18 → 落在視窗內
const NOW = new Date("2026-03-20T04:00:00Z")

function ctx(over: Record<string, unknown> = {}) {
  return {
    user: { id: "u1", tier_id: null, birthday: "1990-03-18", ...over },
    cart: { subtotal: 1000, items: [] },
  } as never
}

/** campaigns 查詢回傳三個生日活動；orders 查詢回傳指定的命中筆數。 */
function mockDb(orderCount: number) {
  fromMock.mockImplementation((table: string) => {
    if (table === "campaigns") {
      return {
        select: () => ({
          eq: () => Promise.resolve({
            data: [{ id: "camp-bday-50" }, { id: "camp-bday-100" }, { id: "camp-bday-150" }],
            error: null,
          }),
        }),
      }
    }
    return {
      select: () => ({
        eq: () => ({
          overlaps: () => ({
            not: () => ({
              gte: () => Promise.resolve({ count: orderCount, error: null }),
            }),
          }),
        }),
      }),
    }
  })
}

beforeEach(() => vi.clearAllMocks())

describe("生日禮金 — 一年限用一次", () => {
  it("★ 視窗內第一次：折抵 50", async () => {
    mockDb(0)
    const r = await evalBirthdayBonus(CAMPAIGN, ctx(), NOW)
    expect(r.applied).toBe(true)
    expect(r.discount_amount).toBe(50)
  })

  it("★ 同一個生日視窗內第二次：不再折抵", async () => {
    mockDb(1)
    const r = await evalBirthdayBonus(CAMPAIGN, ctx(), NOW)
    expect(r.applied).toBe(false)
    expect(r.reason).toContain("一年限用一次")
  })

  it("★ 比對的是 birthday_bonus 全類型，不是單一活動 —— 視窗中途升等不能再領一次", async () => {
    // 之前那筆用的是知心之友的活動 (camp-bday-100)，現在評估初心之友的
    // camp-bday-50，一樣要被擋下來。
    mockDb(1)
    const r = await evalBirthdayBonus(CAMPAIGN, ctx(), NOW)
    expect(r.applied).toBe(false)
  })

  it("★ 查詢失敗時放行 —— 寧可偶爾多送，也不要在結帳頁默默拿掉客人的折扣", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "campaigns") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "camp-bday-50" }], error: null }) }) }
      }
      return {
        select: () => ({
          eq: () => ({
            overlaps: () => ({
              not: () => ({ gte: () => Promise.resolve({ count: null, error: { message: "boom" } }) }),
            }),
          }),
        }),
      }
    })
    const r = await evalBirthdayBonus(CAMPAIGN, ctx(), NOW)
    expect(r.applied).toBe(true)
  })

  it("沒有生日資料仍然直接跳過，不會去查資料庫", async () => {
    mockDb(0)
    const r = await evalBirthdayBonus(CAMPAIGN, ctx({ birthday: null }), NOW)
    expect(r.applied).toBe(false)
    expect(r.reason).toContain("無生日資料")
    expect(fromMock).not.toHaveBeenCalled()
  })

  it("不在視窗內也不會去查資料庫", async () => {
    mockDb(0)
    const r = await evalBirthdayBonus(CAMPAIGN, ctx(), new Date("2026-08-01T04:00:00Z"))
    expect(r.applied).toBe(false)
    expect(r.reason).toContain("window")
    expect(fromMock).not.toHaveBeenCalled()
  })
})
