import { describe, expect, it } from "vitest"
import {
  buildOrderPreviewItems,
  formatShippingPreviewLabel,
  getFreeShippingProgress,
  toApiShippingMethod,
} from "../shipping-preview"

describe("shipping preview helpers", () => {
  it("maps checkout shipping methods to API shipping methods", () => {
    expect(toApiShippingMethod("711")).toBe("cvs_711")
    expect(toApiShippingMethod("family")).toBe("cvs_family")
    expect(toApiShippingMethod("home_delivery")).toBe("home_delivery")
    expect(toApiShippingMethod("overseas_cod")).toBe("overseas_cod")
  })

  it("formats server-computed shipping before any fallback value", () => {
    expect(
      formatShippingPreviewLabel({
        preview: { shipping: 65, free_shipping_names: [] },
        fallbackLabel: "NT$ 150",
      }),
    ).toBe("NT$ 65")
  })

  it("does not mark shipping free when the threshold is disabled", () => {
    expect(getFreeShippingProgress({ subtotal: 2000, threshold: 0 })).toEqual({
      enabled: false,
      reached: false,
      remaining: 0,
      pct: 0,
    })
  })

  it("builds order preview item payloads in cents", () => {
    expect(
      buildOrderPreviewItems([
        {
          variantId: "v1",
          productName: "商品",
          variantName: "規格",
          price: 123.45,
          qty: 2,
        },
      ]),
    ).toEqual([
      {
        variantId: "v1",
        qty: 2,
        unitPrice: 12345,
        productName: "商品",
        variantName: "規格",
      },
    ])
  })
})
