import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
}))

vi.mock("../settings", () => ({
  getSetting: mockGetSetting,
}))

import { computeShipping, getShippingRule, isTaiwanWednesday } from "../shipping"

// 2026-08-19 is a Wednesday; 2026-08-20 is a Thursday. Times pinned to noon
// UTC so the +8h Taiwan-offset math never crosses a day boundary either way.
const A_WEDNESDAY = new Date("2026-08-19T12:00:00Z")
const A_THURSDAY = new Date("2026-08-20T12:00:00Z")

describe("shipping settings", () => {
  beforeEach(() => {
    mockGetSetting.mockReset()
  })

  it("loads home delivery fee and free-shipping threshold from settings", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "shipping.fee_home_delivery") return "180"
      if (key === "shipping.free_threshold_home") return "1200"
      return null
    })

    await expect(getShippingRule("home_delivery")).resolves.toEqual({
      fee: 180,
      free_threshold: 1200,
    })
    await expect(computeShipping("home_delivery", 1199)).resolves.toBe(180)
    await expect(computeShipping("home_delivery", 1200)).resolves.toBe(0)
  })

  it("keeps overseas COD online shipping at zero", async () => {
    await expect(getShippingRule("overseas_cod")).resolves.toEqual({
      fee: 0,
      free_threshold: 0,
    })
    await expect(computeShipping("overseas_cod", 100)).resolves.toBe(0)
  })

  it("uses the everyday CVS threshold on a normal day", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "shipping.fee_cvs") return "80"
      if (key === "shipping.free_threshold_cvs") return "649"
      return null
    })

    await expect(getShippingRule("cvs_711", undefined, A_THURSDAY)).resolves.toEqual({
      fee: 80,
      free_threshold: 649,
    })
  })

  it("switches plain 超商取貨 to the Wednesday threshold (default 499)", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "shipping.fee_cvs") return "80"
      if (key === "shipping.free_threshold_cvs") return "649"
      return null // shipping.free_threshold_cvs_wed unset -> falls back to 499
    })

    await expect(getShippingRule("cvs_711", undefined, A_WEDNESDAY)).resolves.toEqual({
      fee: 80,
      free_threshold: 499,
    })
    await expect(getShippingRule("cvs_family", undefined, A_WEDNESDAY)).resolves.toEqual({
      fee: 80,
      free_threshold: 499,
    })
    await expect(computeShipping("cvs_711", 499, undefined, A_WEDNESDAY)).resolves.toBe(0)
    await expect(computeShipping("cvs_711", 498, undefined, A_WEDNESDAY)).resolves.toBe(80)
  })

  it("honors a configured shipping.free_threshold_cvs_wed override", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "shipping.fee_cvs") return "80"
      if (key === "shipping.free_threshold_cvs") return "649"
      if (key === "shipping.free_threshold_cvs_wed") return "399"
      return null
    })

    await expect(getShippingRule("cvs_711", undefined, A_WEDNESDAY)).resolves.toEqual({
      fee: 80,
      free_threshold: 399,
    })
  })

  it("does NOT apply the Wednesday threshold to home delivery or CVS COD", async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === "shipping.fee_home_delivery") return "150"
      if (key === "shipping.free_threshold_home") return "999"
      if (key === "shipping.fee_cvs_cod") return "80"
      if (key === "shipping.free_threshold_cvs_cod") return "999"
      return null
    })

    await expect(getShippingRule("home_delivery", undefined, A_WEDNESDAY)).resolves.toEqual({
      fee: 150,
      free_threshold: 999,
    })
    await expect(getShippingRule("cvs_711", "cvs_cod", A_WEDNESDAY)).resolves.toEqual({
      fee: 80,
      free_threshold: 999,
    })
  })

  it("isTaiwanWednesday correctly identifies Wednesday in Taiwan time", () => {
    expect(isTaiwanWednesday(A_WEDNESDAY)).toBe(true)
    expect(isTaiwanWednesday(A_THURSDAY)).toBe(false)
    // 16:30 UTC on Tuesday = 00:30 Wednesday in Taiwan (+8h) — the boundary case.
    expect(isTaiwanWednesday(new Date("2026-08-18T16:30:00Z"))).toBe(true)
  })
})
