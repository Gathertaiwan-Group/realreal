/**
 * 出貨通知信 —— 超商取貨付款的金額必須出現在這封信裡。
 *
 * COD 客人收到出貨信時錢還沒付，他們要帶著金額走到門市櫃檯。金額原本只出現在
 * 下單當天那封「訂單已成立」的信裡；等包裹到店、簡訊通知、真的去取貨時，那封
 * 信早就被埋在信箱深處。出貨信是最接近取貨時點的一封，金額得跟著它走。
 *
 * 反過來也要鎖住：已經線上付過款的訂單絕不能出現任何金額。看到「請付 NT$ x」
 * 的第一個反應是「我不是付過了嗎？是不是被扣兩次？」
 */
import { describe, it, expect } from "vitest"
import { renderOrderShipped } from "../OrderShipped"

describe("renderOrderShipped", () => {
  it("★ 超商取貨付款：信裡寫出取貨要付的金額與門市", () => {
    const html = renderOrderShipped({
      orderNumber: "10000161",
      customerName: "王小姐",
      codAmount: 750,
      pickupInfo: "7-11 玫瑰門市 (287638)",
    })

    expect(html).toContain("NT$ 750")
    expect(html).toContain("超商取貨付款")
    expect(html).toContain("7-11 玫瑰門市 (287638)")
    expect(html).toContain("7 天內取貨")
  })

  it("★ 已付款的訂單完全不提金額（避免客人以為被重複請款）", () => {
    const html = renderOrderShipped({
      orderNumber: "10000170",
      customerName: "黃小姐",
      pickupInfo: "7-11 虎欣門市 (184380)",
    })

    expect(html).not.toContain("超商取貨付款")
    expect(html).not.toContain("NT$")
    expect(html).toContain("請留意手機通知到貨訊息")
  })

  it("金額千分位有逗號 —— 四位數以上的 COD 金額要好讀", () => {
    const html = renderOrderShipped({
      orderNumber: "10000148",
      customerName: "陳先生",
      codAmount: 1695,
    })

    expect(html).toContain("NT$ 1,695")
  })

  it("沒有取件資訊時不留下空白欄位", () => {
    const html = renderOrderShipped({ orderNumber: "10000001", customerName: "顧客" })
    expect(html).not.toContain("取件資訊")
  })
})
