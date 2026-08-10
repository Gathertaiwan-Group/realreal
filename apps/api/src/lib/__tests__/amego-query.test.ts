/**
 * findInvoiceByOrderId 的三態語意。
 *
 * 這一支的每一個 case 都對應一個「判斷錯了就會多開一張真發票」的分岔：
 *
 *   code 0 + 號碼   已經開過了 → 認回
 *   code 71         確定還沒開過 → 可以開      ← 唯一可以被讀成「安全開立」的碼
 *   其他碼 / 例外   不知道 → **不可以**當成「還沒開過」
 *
 * 最後那條界線是整套冪等機制的前提。把「查詢失敗」誤讀成「還沒開過」，重試路徑就會
 * 從「防重複」變成「製造重複」—— 而那正是這次要修的東西。
 *
 * payload 形狀已對 Amego 測試環境（統編 12345678）實測：
 *   { type:"order", order_id }  → {"code":71,"msg":"查無資料"}
 *   [{ InvoiceNumber }]         → {"code":31,"msg":"type 查詢類型不存在"}（改版前的舊寫法）
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("axios", () => ({ default: { post: vi.fn() } }))
vi.mock("../settings", () => ({
  getSettingOrEnv: vi.fn(async (_k: string, env: string) =>
    env === "AMEGO_TAX_ID" ? "12345678" : env === "AMEGO_APP_KEY" ? "test-app-key" : "true",
  ),
}))

import axios from "axios"
import {
  AMEGO_CODE_DUPLICATE_ORDER,
  AmegoError,
  findInvoiceByOrderId,
  issueInvoice,
} from "../amego"

const post = vi.mocked(axios.post)

beforeEach(() => vi.clearAllMocks())

describe("findInvoiceByOrderId", () => {
  it("送出 { type:'order', order_id } 到 /json/invoice_query（實測過的形狀）", async () => {
    post.mockResolvedValue({ data: { code: 71, msg: "查無資料" } } as any)

    await findInvoiceByOrderId("10000050")

    const [url, body] = post.mock.calls[0]
    expect(url).toContain("/json/invoice_query")
    const parsed = new URLSearchParams(body as string)
    expect(JSON.parse(parsed.get("data")!)).toEqual({ type: "order", order_id: "10000050" })
  })

  it("查得到 → ok + hit（帶回發票號碼）", async () => {
    post.mockResolvedValue({
      data: {
        code: 0,
        data: { invoice_number: "ZA10034112", random_number: "1618", total_amount: 1650, wait: [] },
      },
    } as any)

    const r = await findInvoiceByOrderId("10000050")

    expect(r).toEqual({
      ok: true,
      hit: { invoiceNumber: "ZA10034112", randomNumber: "1618", totalAmount: 1650, pendingVoid: false },
    })
  })

  it("code 71 查無資料 → 查詢成功、hit 為 null（= 確定還沒開過）", async () => {
    post.mockResolvedValue({ data: { code: 71, msg: "查無資料" } } as any)

    const r = await findInvoiceByOrderId("NO-SUCH")

    expect(r).toEqual({ ok: true, hit: null })
  })

  it("其他錯誤碼 → ok:false（**絕不可**被當成「還沒開過」）", async () => {
    post.mockResolvedValue({ data: { code: 16, msg: "sign(簽名)驗證錯誤" } } as any)

    const r = await findInvoiceByOrderId("10000050")

    expect(r.ok).toBe(false)
    expect((r as any).msg).toContain("16")
  })

  it("連線失敗（IP 白名單／逾時）→ ok:false，不是 hit:null", async () => {
    post.mockRejectedValue(new Error("connect ETIMEDOUT"))

    const r = await findInvoiceByOrderId("10000050")

    expect(r.ok).toBe(false)
    expect((r as any).msg).toContain("ETIMEDOUT")
  })

  it("code 0 但沒有號碼 → 當成「查不出來」而不是「還沒開過」", async () => {
    post.mockResolvedValue({ data: { code: 0, data: {} } } as any)

    const r = await findInvoiceByOrderId("10000050")

    expect(r.ok).toBe(false)
  })

  it("wait 裡有 C0501 → pendingVoid", async () => {
    post.mockResolvedValue({
      data: { code: 0, data: { invoice_number: "ZA1", wait: [{ invoice_type: "C0501" }] } },
    } as any)

    const r = await findInvoiceByOrderId("10000050")

    expect((r as any).hit.pendingVoid).toBe(true)
  })
})

describe("issueInvoice 的錯誤碼保存", () => {
  const params = {
    orderId: "uuid-1",
    orderNumber: "10000050",
    amount: 1650,
    taxAmount: 0,
    type: "B2C_2" as const,
    items: [{ name: "禮盒", qty: 1, unitPrice: 1650 }],
  }

  it("OrderId 重複 → 拋 AmegoError 且 code=3040171（呼叫端據此認回）", async () => {
    post.mockResolvedValue({ data: { code: 3040171, msg: "OrderId 重複" } } as any)

    const err = await issueInvoice(params).catch((e) => e)

    expect(err).toBeInstanceOf(AmegoError)
    expect(err.code).toBe(AMEGO_CODE_DUPLICATE_ORDER)
  })

  it("OrderId 送的是 order_number（= 與反查同一把冪等鍵）", async () => {
    post.mockResolvedValue({ data: { code: 0, invoice_number: "ZA1", random_number: "1" } } as any)

    await issueInvoice(params)

    const parsed = new URLSearchParams(post.mock.calls[0][1] as string)
    expect(JSON.parse(parsed.get("data")!).OrderId).toBe("10000050")
  })
})
