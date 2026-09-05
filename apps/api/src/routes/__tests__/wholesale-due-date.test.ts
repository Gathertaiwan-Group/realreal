/**
 * 批發訂單的付款到期日。
 *
 * 「出貨時附上出貨單／帳單，收貨後 3 個工作天或月底付款」—— 到期日就印在那張
 * 帳單上，算錯就是催款催錯日子。出貨都在台灣，所以一律以台北時間起算。
 */
import { describe, it, expect } from "vitest"
import { calcDueDate } from "../admin-wholesale"

describe("付款到期日", () => {
  it("★ 收貨後 3 個工作天：週一出貨 → 週四", () => {
    // 2026-09-07 是週一
    expect(calcDueDate(new Date("2026-09-07T02:00:00Z"), "on_receipt_3d")).toBe("2026-09-10")
  })

  it("★ 跳過週末：週四出貨 → 下週二（不是週日）", () => {
    // 2026-09-10 週四 → 五、(六日跳過)、一、二
    expect(calcDueDate(new Date("2026-09-10T02:00:00Z"), "on_receipt_3d")).toBe("2026-09-15")
  })

  it("★ 週五出貨 → 下週三", () => {
    expect(calcDueDate(new Date("2026-09-11T02:00:00Z"), "on_receipt_3d")).toBe("2026-09-16")
  })

  it("月底結：當月最後一天", () => {
    expect(calcDueDate(new Date("2026-09-07T02:00:00Z"), "month_end")).toBe("2026-09-30")
  })

  it("月底結：二月要算對天數", () => {
    expect(calcDueDate(new Date("2026-02-10T02:00:00Z"), "month_end")).toBe("2026-02-28")
  })

  it("★ 用台北時間判斷日期：UTC 還是 9/7 晚上，台北已是 9/8", () => {
    // UTC 2026-09-07T17:00 = 台北 2026-09-08 01:00（週二）→ 三、四、五
    expect(calcDueDate(new Date("2026-09-07T17:00:00Z"), "on_receipt_3d")).toBe("2026-09-11")
  })

  it("★ 月底結也看台北時間：UTC 9/30 晚上其實已經是 10/1", () => {
    expect(calcDueDate(new Date("2026-09-30T17:00:00Z"), "month_end")).toBe("2026-10-31")
  })
})
