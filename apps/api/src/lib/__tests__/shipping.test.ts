import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
}))

vi.mock("../settings", () => ({
  getSetting: mockGetSetting,
}))

import { computeShipping, getShippingRule } from "../shipping"

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
})
