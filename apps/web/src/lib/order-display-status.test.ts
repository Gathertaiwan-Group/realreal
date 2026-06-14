import { describe, it, expect } from "vitest"
import { getOrderDisplayStatus } from "./order-display-status"

describe("getOrderDisplayStatus", () => {
  // Regression: marking an order shipped/completed with NO logistics row
  // (manual 出貨/完成, or sandbox/test orders) used to fall through to the
  // "failed" fallback → red ✕ banner with a raw "shipped"/"completed" label.
  it("shipped with no logistics → 運送中 (not a failed red ✕)", () => {
    const d = getOrderDisplayStatus({ status: "shipped" }, null)
    expect(d.key).toBe("in_transit")
    expect(d.label).toBe("運送中")
  })

  it("completed with no logistics → 已配達 (not failed)", () => {
    const d = getOrderDisplayStatus({ status: "completed" }, null)
    expect(d.key).toBe("delivered")
    expect(d.label).toBe("已配達")
  })

  it("processing with no logistics → 待出貨", () => {
    expect(getOrderDisplayStatus({ status: "processing" }, null).key).toBe("awaiting_shipment")
  })

  // Preserved behaviours.
  it("pending → 待付款", () => {
    expect(getOrderDisplayStatus({ status: "pending" }, null).key).toBe("awaiting_payment")
  })

  it("cancelled → 已取消", () => {
    expect(getOrderDisplayStatus({ status: "cancelled" }, null).key).toBe("cancelled")
  })

  it("genuine failed → 失敗 (still red)", () => {
    expect(getOrderDisplayStatus({ status: "failed" }, null).key).toBe("failed")
  })

  it("failed + returned logistics → 過期未取退回", () => {
    const d = getOrderDisplayStatus({ status: "failed" }, { status: "returned", type: "HOME" })
    expect(d.key).toBe("returned_unclaimed")
  })

  it("CVS shipped + arrived_cvs → 已到店待取", () => {
    const d = getOrderDisplayStatus({ status: "shipped" }, { status: "arrived_cvs", type: "CVS" })
    expect(d.key).toBe("arrived_cvs")
  })

  it("CVS completed + delivered → 已取貨", () => {
    const d = getOrderDisplayStatus({ status: "completed" }, { status: "delivered", type: "CVS" })
    expect(d.key).toBe("picked_up")
  })

  it("unknown status → failed fallback with raw label", () => {
    const d = getOrderDisplayStatus({ status: "weird" }, null)
    expect(d.key).toBe("failed")
    expect(d.label).toBe("weird")
  })
})
