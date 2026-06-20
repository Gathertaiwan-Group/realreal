import { describe, it, expect } from "vitest"
import { parseEcpayLogisticsResponse } from "../ecpay-logistics"

describe("parseEcpayLogisticsResponse", () => {
  it("parses key=value success form", () => {
    const r = parseEcpayLogisticsResponse(
      "RtnCode=1&RtnMsg=OK&AllPayLogisticsID=987654&CVSPaymentNo=ABC123&CVSValidationNo=4567",
    )
    expect(r.RtnCode).toBe("1")
    expect(r.AllPayLogisticsID).toBe("987654")
    expect(r.CVSPaymentNo).toBe("ABC123")
    expect(r.CVSValidationNo).toBe("4567")
  })

  it("parses pipe-delimited failure form (code|message)", () => {
    // The real response that surfaced as `RtnCode=? RtnMsg=?` before this fix.
    const r = parseEcpayLogisticsResponse(
      "10500036|收件人姓名請設定為 4~10 字元（中文 2~5 個字，英文 4~10 個字）。",
    )
    expect(r.RtnCode).toBe("10500036")
    expect(r.RtnMsg).toContain("收件人姓名請設定為")
  })

  it("parses pipe-delimited success form (1|urlencoded data)", () => {
    const r = parseEcpayLogisticsResponse(
      "1|MerchantID=2000132&AllPayLogisticsID=987654&CVSPaymentNo=ABC123&CVSValidationNo=4567",
    )
    expect(r.RtnCode).toBe("1")
    expect(r.AllPayLogisticsID).toBe("987654")
    expect(r.CVSPaymentNo).toBe("ABC123")
  })

  it("does not reinterpret a genuine key=value body that starts with a number", () => {
    // RtnCode present in key=value form → pipe heuristic must not clobber it.
    const r = parseEcpayLogisticsResponse("RtnCode=1&RtnMsg=1|fake")
    expect(r.RtnCode).toBe("1")
    expect(r.RtnMsg).toBe("1|fake")
  })
})
