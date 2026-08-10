/**
 * POST /admin/invoices/:id/reissue — 補開路徑。
 *
 * 這條路徑是 27 筆已付款但發票沒開出來的訂單唯一的補開入口，所以它必須：
 *   a) 在新設計下**安全可重跑**（連按兩次不會變成兩張發票）
 *   b) 不會因為自動重試燒完（retry_count 到上限）而變成按了沒反應
 *
 * (a) 的保證不在這一層 —— 是 migration 0049 的 claim_invoice_issue。這裡驗的是這一
 * 層沒有把它擋掉：每一次按下去都真的產生一個 job（jobId 唯一），剩下的交給 DB 去
 * 序列化。反過來如果 jobId 寫死，BullMQ 會靜默吃掉第二次之後的每一次呼叫，admin
 * 看到成功訊息但什麼都沒發生。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  },
}))
vi.mock("../../lib/queue", () => ({
  inventoryQueue: { add: vi.fn() },
  invoiceQueue: { add: vi.fn() },
}))
vi.mock("../../lib/amego", () => ({
  voidInvoice: vi.fn(),
  invoicePdfUrl: vi.fn(() => "https://invoice-api.amego.tw/invoice/pdf/ZA1"),
}))
vi.mock("../../lib/enqueue-post-payment", () => ({ enqueuePostPaymentJobs: vi.fn() }))
vi.mock("../../lib/ecpay-logistics", () => ({ cancelEcpayLogistics: vi.fn() }))
vi.mock("../../lib/refund-payment", () => ({ refundPayment: vi.fn() }))
vi.mock("../../lib/points", () => ({ refundOrderPoints: vi.fn(), refundPointsForOrder: vi.fn() }))
vi.mock("../../lib/tier", () => ({ decrementSpendOnRefund: vi.fn() }))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"
import { invoiceQueue } from "../../lib/queue"

const INVOICE_ID = "00000000-0000-0000-0000-0000000000ff"

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "admin-1", email: "admin@example.com" } },
    error: null,
  } as never)
}

function chain(opts: { terminal?: any; single?: any } = {}) {
  const terminal = opts.terminal ?? { data: [], error: null }
  const single = opts.single ?? { data: null, error: null }
  const c: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(single),
    maybeSingle: vi.fn().mockResolvedValue(single),
    then: (resolve: (v: any) => void) => resolve(terminal),
  }
  return c
}

function adminProfileChain() {
  return chain({ single: { data: { role: "admin" }, error: null } })
}

/** invoices row served to the route, plus a capture of the update payload. */
function withInvoice(status: string) {
  const invoicesChain = chain({ single: { data: { id: INVOICE_ID, status }, error: null } })
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "user_profiles") return adminProfileChain() as any
    if (table === "invoices") return invoicesChain as any
    return chain() as any
  })
  return invoicesChain
}

const reissue = () =>
  request(app).post(`/admin/invoices/${INVOICE_ID}/reissue`).set("Authorization", "Bearer t")

describe("POST /admin/invoices/:id/reissue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
  })

  it("pending 的發票可以補開，並清掉 error_message 與 retry_count", async () => {
    const invoices = withInvoice("pending")

    const res = await reissue()

    expect(res.status).toBe(200)
    // retry_count 歸零是刻意的人工 override：線上有 3 列卡在 retry_count=10，
    // 少了這個它們永遠無法從後台補開。
    expect(invoices.update).toHaveBeenCalledWith({ error_message: null, retry_count: 0 })
    expect(invoiceQueue.add).toHaveBeenCalledTimes(1)
  })

  it("★ 連續呼叫兩次都真的入列（jobId 唯一），不會被 BullMQ 靜默吃掉", async () => {
    withInvoice("pending")

    const first = await reissue()
    const second = await reissue()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(invoiceQueue.add).toHaveBeenCalledTimes(2)

    const jobIds = vi.mocked(invoiceQueue.add).mock.calls.map((c: any[]) => c[2].jobId)
    expect(jobIds[0]).toBeTruthy()
    expect(jobIds[0]).not.toBe(jobIds[1])
    expect(jobIds[0]).toContain(INVOICE_ID)
  })

  it("已開立 → 400，且不入列（快速回饋；真正的保護在 DB claim）", async () => {
    withInvoice("issued")

    const res = await reissue()

    expect(res.status).toBe(400)
    expect(invoiceQueue.add).not.toHaveBeenCalled()
  })

  it("卡在 issuing 的仍可補開入列 —— status 不被重設，交給 claim 判斷是在途還是過期", async () => {
    const invoices = withInvoice("issuing")

    const res = await reissue()

    expect(res.status).toBe(200)
    expect(invoiceQueue.add).toHaveBeenCalledTimes(1)
    // 絕不能在這裡把 status 拉回 pending：那等於對一張可能已經在 Amego 的發票
    // 再發一次 claim。
    const payload = vi.mocked(invoices.update).mock.calls[0][0]
    expect(payload).not.toHaveProperty("status")
  })

  it("找不到 → 404", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      return chain({ single: { data: null, error: { message: "no rows" } } }) as any
    })

    const res = await reissue()

    expect(res.status).toBe(404)
    expect(invoiceQueue.add).not.toHaveBeenCalled()
  })
})

describe("POST /admin/invoices/reclaim-stale", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAdminAuth()
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") return adminProfileChain() as any
      return chain() as any
    })
  })

  it("呼叫 reclaim_stale_invoices 並回報撿回幾筆", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ invoice_id: INVOICE_ID, order_id: "o1", stuck_since: null, attempts: 2 }],
      error: null,
    } as never)

    const res = await request(app)
      .post("/admin/invoices/reclaim-stale")
      .set("Authorization", "Bearer t")
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)
    expect(supabase.rpc).toHaveBeenCalledWith("reclaim_stale_invoices", {
      p_stale_after: "10 minutes",
      p_limit: 100,
    })
  })
})
