/**
 * 首購折扣與生日禮金不可併用。
 *
 * pickBestPerType 只做「同類型取最好」，跨類型一律疊加。而首購當下的會員一定是
 * 初心之友（累積消費 0 元），所以兩者剛好都是 50 —— 生日當月註冊並下第一筆單的
 * 客人會直接折 100。
 *
 * 平手時留首購，理由不是隨便挑的：首購只認第一筆訂單，這筆單一完成就永遠失效；
 * 生日禮金整個當月都還能用在下一筆。留首購 → 客人兩份都拿得到；留生日 → 首購
 * 直接蒸發。
 */
import { describe, it, expect } from "vitest"
import { resolveExclusiveCampaigns, type EvaluatorResult } from "../campaigns-evaluator"

function r(type: string, discount: number, id = type): EvaluatorResult {
  return {
    campaign_id: id,
    campaign_name: type,
    type,
    applied: true,
    discount_amount: discount,
  }
}

describe("首購 × 生日禮金 互斥", () => {
  it("★ 兩者都符合時只留一個，不會疊加", () => {
    const kept = resolveExclusiveCampaigns([r("first_purchase", 50), r("birthday_bonus", 50)])
    expect(kept).toHaveLength(1)
  })

  it("★ 金額相同時留首購 —— 生日禮金當月還能用在下一筆，首購過了就沒了", () => {
    const kept = resolveExclusiveCampaigns([r("first_purchase", 50), r("birthday_bonus", 50)])
    expect(kept[0].type).toBe("first_purchase")
  })

  it("★ 生日禮金比較高時留生日禮金（同心之友 150 > 首購 50）", () => {
    const kept = resolveExclusiveCampaigns([r("first_purchase", 50), r("birthday_bonus", 150)])
    expect(kept).toHaveLength(1)
    expect(kept[0].type).toBe("birthday_bonus")
    expect(kept[0].discount_amount).toBe(150)
  })

  it("順序顛倒結果一樣（不受陣列順序影響）", () => {
    const kept = resolveExclusiveCampaigns([r("birthday_bonus", 150), r("first_purchase", 50)])
    expect(kept[0].type).toBe("birthday_bonus")
  })

  it("★ 其他活動不受影響，該疊加的照樣疊加", () => {
    const kept = resolveExclusiveCampaigns([
      r("first_purchase", 50),
      r("birthday_bonus", 50),
      r("spend_threshold", 0),
      r("freebie", 0),
      r("discount", 200),
    ])
    const types = kept.map((x) => x.type).sort()
    expect(types).toEqual(["discount", "first_purchase", "freebie", "spend_threshold"])
  })

  it("只有其中一個時原樣保留", () => {
    expect(resolveExclusiveCampaigns([r("birthday_bonus", 100)])).toHaveLength(1)
    expect(resolveExclusiveCampaigns([r("first_purchase", 50)])).toHaveLength(1)
  })

  it("空陣列不會爆", () => {
    expect(resolveExclusiveCampaigns([])).toEqual([])
  })
})
