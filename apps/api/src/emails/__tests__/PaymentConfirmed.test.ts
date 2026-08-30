import { describe, expect, it } from "vitest"
import { renderPaymentConfirmed } from "../PaymentConfirmed"

const baseData = {
  orderNumber: "RR20260830001",
  amount: "500",
  customerName: "王小明",
  items: [{ name: "初心原味", qty: 1, price: "67" }],
  pickupInfo: "宅配｜台北市",
}

describe("renderPaymentConfirmed — membership CTA", () => {
  it("omits the CTA when isGuestOrder is not set (member order)", () => {
    const html = renderPaymentConfirmed(baseData)
    expect(html).not.toContain("加入會員")
  })

  it("omits the CTA when isGuestOrder is explicitly false", () => {
    const html = renderPaymentConfirmed({ ...baseData, isGuestOrder: false })
    expect(html).not.toContain("加入會員")
  })

  it("includes the CTA when isGuestOrder is true", () => {
    const html = renderPaymentConfirmed({ ...baseData, isGuestOrder: true })
    expect(html).toContain("加入會員")
    expect(html).toContain("/checkout/confirm?order=RR20260830001")
  })
})
