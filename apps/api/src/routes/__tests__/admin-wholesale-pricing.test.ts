/**
 * 通路商批發價的取價與金額計算。
 *
 * 這段算的是開給通路商的價格與帳單金額，錯了就是開錯帳單、月底對帳吵架。五家
 * 通路商的價格「略有不同」，所以資料結構是「標準價一份 + 個別例外」，取價一律
 * coalesce(例外, 標準) —— 這裡鎖住那個規則的每一種邊界。
 */
import { describe, it, expect } from "vitest"
import {
  mergeChannelPrices,
  calcWholesaleTotals,
  type VariantMeta,
} from "../admin-wholesale"

const SACHET = "11111111-1111-1111-1111-111111111111"
const POUCH = "22222222-2222-2222-2222-222222222222"

const META = new Map<string, VariantMeta>([
  [SACHET, { productName: "可可｜50克", variantName: "預設", stockQty: 80 }],
  [POUCH, { productName: "可可｜300克", variantName: "預設", stockQty: 30 }],
])

const STANDARD = [
  { variant_id: SACHET, list_price: 67, wholesale_price: 46 },
  { variant_id: POUCH, list_price: 400, wholesale_price: 243 },
]

describe("批發取價 — 標準價 + 個別例外", () => {
  it("★ 沒有例外時用標準價，且標記為未覆寫", () => {
    // 依 variantId 取，不依賴排序 —— 清單是照商品名稱排的（「300克」排在
    // 「50克」前面，因為字元 3 小於 5），排序規則跟取價正確與否無關。
    const rows = mergeChannelPrices(STANDARD, [], META)
    const byId = new Map(rows.map((r) => [r.variantId, r]))
    expect(byId.get(SACHET)).toMatchObject({ price: 46, isOverridden: false })
    expect(byId.get(POUCH)).toMatchObject({ price: 243, isOverridden: false })
  })

  it("★ 有例外時用例外價（原粹蔬食作的隨身包 51）", () => {
    const rows = mergeChannelPrices(
      STANDARD,
      [{ channel_id: "c", variant_id: SACHET, wholesale_price: 51, is_available: true }],
      META,
    )
    const sachet = rows.find((r) => r.variantId === SACHET)!
    expect(sachet.price).toBe(51)
    expect(sachet.standardPrice).toBe(46)
    expect(sachet.isOverridden).toBe(true)
  })

  it("★ 不供貨的品項，價格落回標準價而不是 0", () => {
    // 原粹蔬食作完全不賣夾鏈袋：那一列 is_available=false、wholesale_price=null。
    // 如果這裡寫成 ||，null 會被當成 falsy 而讓價格變成標準價沒錯，但若哪天
    // 例外價真的是 0（贈品價），|| 就會錯誤地跳回標準價。用 ?? 才對。
    const rows = mergeChannelPrices(
      STANDARD,
      [{ channel_id: "c", variant_id: POUCH, wholesale_price: null, is_available: false }],
      META,
    )
    const pouch = rows.find((r) => r.variantId === POUCH)!
    expect(pouch.isAvailable).toBe(false)
    expect(pouch.price).toBe(243)
    expect(pouch.isOverridden).toBe(true)
  })

  it("★ 例外價剛好等於標準價，仍然算「有覆寫」", () => {
    // 這是整個設計的關鍵：談定的 46 和「沿用標準的 46」在畫面上一樣，但日後
    // 調整標準價時，前者不該跟著動。靠 isOverridden 分辨，不能比金額。
    const rows = mergeChannelPrices(
      STANDARD,
      [{ channel_id: "c", variant_id: SACHET, wholesale_price: 46, is_available: true }],
      META,
    )
    expect(rows.find((r) => r.variantId === SACHET)!.isOverridden).toBe(true)
  })

  it("找不到商品資料時不會爆，顯示為已刪除", () => {
    const rows = mergeChannelPrices(STANDARD, [], new Map())
    expect(rows[0].productName).toBe("(已刪除的商品)")
  })
})

describe("批發訂單金額 — 150 元/箱、滿 4,000 免運", () => {
  it("未滿 4,000：運費 = 箱數 × 150", () => {
    const r = calcWholesaleTotals([{ unitPrice: 46, qty: 20 }], 2)
    expect(r.subtotal).toBe(920)
    expect(r.shippingFee).toBe(300)
    expect(r.total).toBe(1220)
  })

  it("★ 剛好 4,000 就免運（門檻是「滿」，含等於）", () => {
    const r = calcWholesaleTotals([{ unitPrice: 200, qty: 20 }], 3)
    expect(r.subtotal).toBe(4000)
    expect(r.shippingFee).toBe(0)
    expect(r.total).toBe(4000)
  })

  it("★ 3,999 不免運 —— 邊界只差 1 元", () => {
    const r = calcWholesaleTotals([{ unitPrice: 3999, qty: 1 }], 1)
    expect(r.shippingFee).toBe(150)
    expect(r.total).toBe(4149)
  })

  it("★ 免運門檻比的是商品小計，不含運費本身", () => {
    // 小計 3,900 + 運費 150 = 4,050。如果拿含運費的總額去比門檻，運費會把訂單
    // 推過 4,000 然後把自己消掉，變成客人少付 150。
    const r = calcWholesaleTotals([{ unitPrice: 3900, qty: 1 }], 1)
    expect(r.subtotal).toBe(3900)
    expect(r.shippingFee).toBe(150)
    expect(r.total).toBe(4050)
  })

  it("0 箱（自取）不算運費", () => {
    expect(calcWholesaleTotals([{ unitPrice: 46, qty: 10 }], 0).shippingFee).toBe(0)
  })

  it("多品項小計正確", () => {
    const r = calcWholesaleTotals(
      [
        { unitPrice: 51, qty: 12 },
        { unitPrice: 55, qty: 6 },
      ],
      1,
    )
    expect(r.subtotal).toBe(612 + 330)
  })
})
