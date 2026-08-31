import { describe, it, expect } from "vitest"
import {
  validateCarrierNumber,
  validateLoveCode,
  validateTaxId,
  validateInvoice,
} from "../invoice-carrier"

describe("validateCarrierNumber", () => {
  it("accepts a well-formed 手機條碼", () => {
    expect(validateCarrierNumber("phone", "/ABC1234")).toBeNull()
    expect(validateCarrierNumber("phone", "/MN5NBJ7")).toBeNull()
    // + - . are legal characters in the spec
    expect(validateCarrierNumber("phone", "/+F5S+JQ")).toBeNull()
    expect(validateCarrierNumber("phone", "/.JH9+O2")).toBeNull()
  })

  it("accepts a well-formed 自然人憑證", () => {
    expect(validateCarrierNumber("natural_person", "AB12345678901234")).toBeNull()
  })

  it("★ tells the customer to switch type when a 手機條碼 is typed under 自然人憑證", () => {
    // The exact real-world failure: order #10000172 shipped with
    // carrierType=natural_person and carrierNumber=/KDIY52R, and Amego rejected
    // it days later with 「載具號碼不存在」.
    expect(validateCarrierNumber("natural_person", "/KDIY52R")).toBe(
      "這是手機條碼，請將載具類型改選「手機條碼」",
    )
  })

  it("tells the customer to switch type in the opposite direction too", () => {
    expect(validateCarrierNumber("phone", "AB12345678901234")).toBe(
      "這是自然人憑證，請將載具類型改選「自然人憑證」",
    )
  })

  it("rejects malformed values", () => {
    expect(validateCarrierNumber("phone", "ABC1234")).toContain("手機條碼格式不正確")
    expect(validateCarrierNumber("phone", "/ABC123")).toContain("手機條碼格式不正確")
    expect(validateCarrierNumber("phone", "/abc1234")).toContain("手機條碼格式不正確")
    expect(validateCarrierNumber("natural_person", "A123")).toContain("自然人憑證格式不正確")
  })

  it("rejects an empty value", () => {
    expect(validateCarrierNumber("phone", "")).toBe("請輸入載具號碼")
    expect(validateCarrierNumber("phone", "   ")).toBe("請輸入載具號碼")
    expect(validateCarrierNumber("phone", undefined)).toBe("請輸入載具號碼")
  })

  it("trims surrounding whitespace before judging", () => {
    expect(validateCarrierNumber("phone", "  /ABC1234  ")).toBeNull()
  })
})

describe("validateLoveCode / validateTaxId", () => {
  it("accepts valid values", () => {
    expect(validateLoveCode("919")).toBeNull()
    expect(validateLoveCode("1234567")).toBeNull()
    expect(validateTaxId("12345678")).toBeNull()
  })
  it("rejects invalid values", () => {
    expect(validateLoveCode("12")).toContain("愛心碼格式不正確")
    expect(validateLoveCode("12345678")).toContain("愛心碼格式不正確")
    expect(validateTaxId("1234567")).toContain("統一編號格式不正確")
  })
})

describe("validateInvoice", () => {
  it("ignores carrier fields for 雲端發票 and 統編發票", () => {
    expect(validateInvoice({ type: "B2C_2", carrierNumber: "garbage" })).toBeNull()
    expect(validateInvoice({ type: "B2B", taxId: "12345678", carrierNumber: "x" })).toBeNull()
  })

  it("defaults to 手機條碼 when no carrierType was chosen", () => {
    expect(validateInvoice({ type: "B2C_3", carrierNumber: "/ABC1234" })).toBeNull()
    expect(validateInvoice({ type: "B2C_3", carrierNumber: "nope" })).toContain("手機條碼格式不正確")
  })

  it("validates 愛心碼 on its own field, not carrierNumber", () => {
    expect(validateInvoice({ type: "B2C_3", carrierType: "love_code", loveCode: "919" })).toBeNull()
    expect(validateInvoice({ type: "B2C_3", carrierType: "love_code", loveCode: "" })).toBe("請輸入愛心碼")
  })

  it("catches the #10000172 case end to end", () => {
    expect(
      validateInvoice({ type: "B2C_3", carrierType: "natural_person", carrierNumber: "/KDIY52R" }),
    ).toBe("這是手機條碼，請將載具類型改選「手機條碼」")
  })
})
