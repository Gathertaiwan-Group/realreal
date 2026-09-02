/**
 * 免運文案。兩次事故的回歸測試：
 *
 * 1. 跑馬燈寫死 649/999，後台實際是 650/1000 → 剛好 999 元的宅配客人被承諾
 *    免運，結帳被收 NT$150。
 * 2. 修好跑馬燈之後，FAQ 裡同一句話還留著 649，因為那是另一個檔案。
 *
 * 所以這裡鎖的不只是數字正確，而是「兩個畫面看到的是同一件事」。
 */
import { describe, it, expect } from "vitest"
import {
  freeShippingGroups,
  marqueeShippingMessages,
  shippingFeeAnswer,
  type ShippingConfig,
} from "../shipping-copy"

const SAME: ShippingConfig = {
  cvs: { fee: 80, free_threshold: 999 },
  cvsCod: { fee: 80, free_threshold: 999 },
  home: { fee: 150, free_threshold: 999 },
}

const SPLIT: ShippingConfig = {
  cvs: { fee: 80, free_threshold: 650 },
  cvsCod: { fee: 80, free_threshold: 1000 },
  home: { fee: 150, free_threshold: 1000 },
}

describe("免運文案", () => {
  it("★ 三種寄送方式門檻相同時，講一次「全站」而不是三句", () => {
    const groups = freeShippingGroups(SAME)
    expect(groups).toHaveLength(1)
    expect(groups[0].coversEveryMethod).toBe(true)

    expect(marqueeShippingMessages(SAME)).toEqual(["全站消費滿999元免運"])
    expect(shippingFeeAnswer(SAME)).toContain("全站消費滿 NT$999 免運")
  })

  it("★ 門檻不同時分開講，而且兩個畫面講的是同一組門檻", () => {
    expect(marqueeShippingMessages(SPLIT)).toEqual([
      "超商取貨滿650元免運",
      "超商取貨付款、宅配滿1000元免運",
    ])

    const answer = shippingFeeAnswer(SPLIT)
    expect(answer).toContain("消費滿 NT$650 超商取貨免運")
    expect(answer).toContain("消費滿 NT$1000 超商取貨付款、宅配免運")
  })

  it("★ 運費金額也來自設定，不寫死", () => {
    const answer = shippingFeeAnswer(SAME)
    expect(answer).toContain("宅配運費 NT$150")
    expect(answer).toContain("超商取貨運費 NT$80")
    expect(answer).toContain("超商取貨付款運費 NT$80")
  })

  it("★ 讀不到設定時，寧可不講免運，也不要講錯的數字", () => {
    expect(marqueeShippingMessages(null)).toEqual([])

    // 剩下的只有港澳那句（它本身含「免運活動」四個字，所以要鎖的是「有沒有
    // 講出一個門檻金額」，不是有沒有出現「免運」二字）。
    const answer = shippingFeeAnswer(null)
    expect(answer).not.toContain("消費滿")
    expect(answer).not.toContain("NT$")
    expect(answer).toBe("港澳寄送採順豐速運，運費到付，不適用滿額免運活動。")
  })
})
