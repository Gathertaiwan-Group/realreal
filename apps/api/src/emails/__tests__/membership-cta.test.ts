import { describe, expect, it } from "vitest"
import { renderMembershipCta } from "../membership-cta"

describe("renderMembershipCta", () => {
  it("links to the checkout confirm page with the order number", () => {
    const html = renderMembershipCta("RR20260830001")
    expect(html).toContain("https://realreal.cc/checkout/confirm?order=RR20260830001")
    expect(html).toContain("加入會員")
  })

  it("URL-encodes an order number with special characters", () => {
    const html = renderMembershipCta("RR 2026#001")
    expect(html).toContain("order=RR%202026%23001")
  })
})
