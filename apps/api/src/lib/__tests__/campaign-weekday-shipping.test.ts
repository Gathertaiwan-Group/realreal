/**
 * 「每週六，超商取貨滿 666 免運」需要兩個原本沒有的條件：限定星期、限定取貨方式。
 *
 * 星期用台北時間判斷。週六 00:30（台北）在 UTC 還是週五 16:30 —— 用 UTC 判斷，
 * 週六一開始的半夜訂單拿不到優惠，而週日凌晨反而拿得到，兩邊都會被客訴。
 *
 * 取貨方式要能區分「超商取貨」與「超商取貨付款」。這兩者的 shipping_method 完全
 * 一樣（cvs_711／cvs_family），差別只在付款方式是不是 cvs_cod —— 只看運送方式
 * 會把代收貨款的訂單也一起免運。
 */
import { describe, it, expect } from "vitest"
import { evalFreeShipping, weekdayBlocked } from "../campaigns-evaluator"
import { shippingBucket } from "../shipping"

const SATURDAY_CAMPAIGN = {
  id: "camp-sat",
  name: "週六超商取貨滿666免運",
  type: "free_shipping",
  config: { min_order_amount: 666, active_weekdays: [6], shipping_buckets: ["cvs"] } as Record<
    string,
    unknown
  >,
}

function ctx(subtotal: number, bucket?: string) {
  return {
    user: { id: "u1", tier_id: null, birthday: null },
    cart: { items: [], subtotal, shipping_fee: 80, shipping_bucket: bucket },
  } as never
}

describe("運費級距：超商取貨 vs 超商取貨付款", () => {
  it("★ 兩者的運送方式相同，差別在付款方式", () => {
    expect(shippingBucket("cvs_711", "linepay")).toBe("cvs")
    expect(shippingBucket("cvs_711", "cvs_cod")).toBe("cvsCod")
    expect(shippingBucket("cvs_family", "pchomepay")).toBe("cvs")
    expect(shippingBucket("cvs_family", "cvs_cod")).toBe("cvsCod")
  })

  it("宅配與海外各自成一桶", () => {
    expect(shippingBucket("home_delivery", "linepay")).toBe("home")
    expect(shippingBucket("overseas_cod", "pchomepay")).toBe("overseas")
  })
})

describe("限定星期（台北時間）", () => {
  // 2026-09-05 是星期六
  it("★ 週六生效", () => {
    expect(weekdayBlocked(SATURDAY_CAMPAIGN as never, new Date("2026-09-05T04:00:00Z"))).toBeNull()
  })

  it("★ 週五不生效", () => {
    expect(weekdayBlocked(SATURDAY_CAMPAIGN as never, new Date("2026-09-04T04:00:00Z"))).toContain("限星期六")
  })

  it("★ 台北週六 00:30（UTC 仍是週五 16:30）算週六", () => {
    expect(weekdayBlocked(SATURDAY_CAMPAIGN as never, new Date("2026-09-04T16:30:00Z"))).toBeNull()
  })

  it("★ 台北週日 00:30（UTC 仍是週六 16:30）已經不算週六", () => {
    expect(weekdayBlocked(SATURDAY_CAMPAIGN as never, new Date("2026-09-05T16:30:00Z"))).not.toBeNull()
  })

  it("沒設定 active_weekdays 就是天天生效", () => {
    const always = { ...SATURDAY_CAMPAIGN, config: { min_order_amount: 666 } }
    expect(weekdayBlocked(always as never, new Date("2026-09-04T04:00:00Z"))).toBeNull()
  })
})

describe("限定取貨方式的免運", () => {
  it("★ 超商取貨滿 666 → 免運", () => {
    const r = evalFreeShipping(SATURDAY_CAMPAIGN as never, ctx(666, "cvs"))
    expect(r.applied).toBe(true)
    expect(r.zero_shipping).toBe(true)
  })

  it("★ 超商取貨付款不適用 —— 代收貨款有額外成本", () => {
    const r = evalFreeShipping(SATURDAY_CAMPAIGN as never, ctx(1000, "cvsCod"))
    expect(r.applied).toBe(false)
  })

  it("★ 宅配不適用", () => {
    expect(evalFreeShipping(SATURDAY_CAMPAIGN as never, ctx(1000, "home")).applied).toBe(false)
  })

  it("665 未達門檻", () => {
    expect(evalFreeShipping(SATURDAY_CAMPAIGN as never, ctx(665, "cvs")).applied).toBe(false)
  })

  it("★ 結帳沒帶級距時不套用 —— 寧可少給一次，也不要在不該給的通路給了", () => {
    expect(evalFreeShipping(SATURDAY_CAMPAIGN as never, ctx(1000, undefined)).applied).toBe(false)
  })

  it("沒設定 shipping_buckets 的舊活動，行為不變（全部適用）", () => {
    const anyMethod = { ...SATURDAY_CAMPAIGN, config: { min_order_amount: 666 } }
    expect(evalFreeShipping(anyMethod as never, ctx(700, "cvsCod")).applied).toBe(true)
    expect(evalFreeShipping(anyMethod as never, ctx(700, undefined)).applied).toBe(true)
  })
})
