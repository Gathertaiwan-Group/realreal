import { describe, it, expect } from "vitest"
import { validateCvsReceiverName } from "../ecpay-name"

describe("validateCvsReceiverName", () => {
  it("accepts 2~5 Chinese characters", () => {
    expect(validateCvsReceiverName("王小明")).toBeUndefined()
    expect(validateCvsReceiverName("陳一")).toBeUndefined()
    expect(validateCvsReceiverName("歐陽娜娜娜")).toBeUndefined()
  })

  it("accepts 4~10 Latin letters", () => {
    expect(validateCvsReceiverName("John")).toBeUndefined()
    expect(validateCvsReceiverName("JohnSmith")).toBeUndefined()
  })

  it("allows 間隔號 for indigenous names", () => {
    expect(validateCvsReceiverName("巴萊·瓦")).toBeUndefined()
  })

  it("rejects the real failing case (mixed Chinese+English+digits)", () => {
    expect(validateCvsReceiverName("阿門測試2023wp")).toMatch(/超商取貨姓名/)
  })

  it("rejects too-short, too-long, digits, spaces and symbols", () => {
    expect(validateCvsReceiverName("陳")).toBeDefined() // 1 字過短
    expect(validateCvsReceiverName("一二三四五六")).toBeDefined() // 6 字過長
    expect(validateCvsReceiverName("Christopher")).toBeDefined() // 11 letters
    expect(validateCvsReceiverName("Jo")).toBeDefined() // 2 letters 過短
    expect(validateCvsReceiverName("John Smith")).toBeDefined() // 空白
    expect(validateCvsReceiverName("王小明123")).toBeDefined() // 含數字
    expect(validateCvsReceiverName("王小明!")).toBeDefined() // 含符號
  })

  it("rejects empty / whitespace-only", () => {
    expect(validateCvsReceiverName("")).toBeDefined()
    expect(validateCvsReceiverName("   ")).toBeDefined()
  })
})
