/**
 * 註冊的生日欄位 —— 選填，但填了就要擋得住不合理的值。
 *
 * 這是生日禮金活動能不能運作的前提：三個 birthday_bonus 活動早就啟用，評估器
 * 遇到沒有生日的顧客直接跳過，而 187 位會員裡只有 10 位有資料，因為前台從來
 * 沒有地方可以填。
 *
 * 這裡測的是 schema 本身：沒填要能通過（選填），填了未來日期要擋下來（否則
 * 客人把生日設成下個月就能提前領禮金）。
 */
import { describe, it, expect } from "vitest"
import { z } from "zod"

// 與 auth/actions.ts 的 registerSchema 同一份規則
const birthdaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`)
    return Number.isFinite(t) && t <= Date.now() && d > "1900-01-01"
  })
  .optional()

describe("註冊生日欄位", () => {
  it("★ 沒填可以通過 —— 生日是選填，不能擋住註冊", () => {
    expect(birthdaySchema.safeParse(undefined).success).toBe(true)
  })

  it("正常生日通過", () => {
    expect(birthdaySchema.safeParse("1990-03-18").success).toBe(true)
  })

  it("★ 未來日期擋下來（否則可以把生日設成下個月提前領禮金）", () => {
    const nextYear = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10)
    expect(birthdaySchema.safeParse(nextYear).success).toBe(false)
  })

  it("1900 年以前擋下來", () => {
    expect(birthdaySchema.safeParse("1899-12-31").success).toBe(false)
  })

  it("格式不對擋下來", () => {
    for (const bad of ["1990/03/18", "90-3-18", "abc", "1990-3-8"]) {
      expect(birthdaySchema.safeParse(bad).success).toBe(false)
    }
  })

  it("空字串在 action 裡會先轉成 undefined，不會當成錯誤", () => {
    const raw = ""
    const value = raw.trim() === "" ? undefined : raw
    expect(birthdaySchema.safeParse(value).success).toBe(true)
  })
})
