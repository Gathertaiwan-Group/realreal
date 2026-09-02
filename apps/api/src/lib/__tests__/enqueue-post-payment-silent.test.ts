/**
 * enqueuePostPaymentJobs — 靜音模式。
 *
 * 2026-08-31 事故：批次補算幾個月前的舊訂單時，寄出「付款成功」通知給 20 位
 * 客人（最舊的是 1 月的訂單）。當時流程只對 cvs_cod 靜音，其他付款方式一律寄信。
 *
 * 修法不是縮小批次的選取範圍，而是讓「補算」這件事本身就不寄信 —— 要不要通知
 * 取決於「為什麼跑這條流程」，不是付款方式。這個測試鎖住那個保證：silent 為
 * true 時完全不寄信，但發票／消費／點數／等級照常執行。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock factories are hoisted above const declarations, so the spies have to
// be created inside vi.hoisted() to exist by the time the factories run.
const { sendEmail, renderAndSendEmail, invoiceAdd, inventoryAdd, grantPoints } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  renderAndSendEmail: vi.fn(),
  invoiceAdd: vi.fn(),
  inventoryAdd: vi.fn(),
  grantPoints: vi.fn(),
}))

vi.mock("../email", () => ({
  sendEmail,
  parseRecipients: (raw: string | null | undefined) =>
    raw ? raw.split(/[,;\s]+/).filter((x) => x.includes("@")) : [],
}))
vi.mock("../../workers/email-sender", () => ({ renderAndSendEmail }))
vi.mock("../queue", () => ({
  inventoryQueue: { add: inventoryAdd },
  invoiceQueue: { add: invoiceAdd },
}))
vi.mock("../tier", () => ({ incrementSpendAndUpgrade: vi.fn() }))
vi.mock("../points", () => ({ grantPoints, redeemPoints: vi.fn() }))
vi.mock("../settings", () => ({ getSetting: vi.fn().mockResolvedValue("admin@example.com") }))

const ORDER = {
  id: "o-1",
  order_number: "WP3114",
  subtotal: 2155,
  discount_amount: 0,
  total: 2155,
  guest_email: "customer@example.com",
  user_id: "u-1",
  points_used: 0,
  attributed_kol_slug: null,
  metadata: null,
  payment_method: "linepay", // deliberately NOT cvs_cod — the case that leaked
  notes: null,
  order_items: [],
}

function chain(result: any) {
  const c: Record<string, any> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve: (v: any) => void) => resolve({ data: [], error: null }),
  }
  return c
}

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    auth: { admin: { getUserById: vi.fn().mockResolvedValue({ data: { user: { email: "customer@example.com" } } }) } },
  },
}))

import { enqueuePostPaymentJobs } from "../enqueue-post-payment"
import { supabase } from "../supabase"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "orders") return chain({ data: ORDER, error: null }) as any
    return chain({ data: null, error: null }) as any
  })
})

describe("enqueuePostPaymentJobs — silent", () => {
  it("★ silent:true 時，非 COD 訂單也完全不寄任何信", async () => {
    await enqueuePostPaymentJobs("o-1", { silent: true })

    expect(renderAndSendEmail).not.toHaveBeenCalled() // 客人的付款確認信
    expect(sendEmail).not.toHaveBeenCalled()          // 管理員的新訂單通知
  })

  it("預設（未指定 silent）維持原本行為：非 COD 訂單照常寄信", async () => {
    await enqueuePostPaymentJobs("o-1")

    expect(renderAndSendEmail).toHaveBeenCalled()
  })
})

/**
 * 2026-08-31 事故的第二個後果：同一個批次替 11 筆 WP 舊站訂單開了發票
 * （DV25772577–DV25772587，NT$17,489）。那些訂單在舊平台早就開過發票，等於向
 * 財政部重複申報，只能一張一張作廢。
 *
 * 當時「排除 WP」這條規則只寫在 POST /admin/invoices/reissue-batch 裡，補算批次
 * 走的是另一條路，規則根本不在它的路徑上。規則現在移到每條付款路徑都會經過的
 * enqueuePostPaymentJobs。
 *
 * 第二個測試同樣重要：跳過的只有發票。消費、點數、物流都還是要跑 —— 補算 WP
 * 訂單的消費金額本來就是那次批次的正當目的。
 */
describe("enqueuePostPaymentJobs — WP 舊站訂單不開發票", () => {
  it("★ WP 開頭的訂單不排發票（舊平台已開過，重開就是重複申報）", async () => {
    await enqueuePostPaymentJobs("o-1", { silent: true })

    expect(invoiceAdd).not.toHaveBeenCalled()
  })

  it("★ 但消費、點數、物流照跑 —— 跳過的只有發票", async () => {
    await enqueuePostPaymentJobs("o-1", { silent: true })

    expect(grantPoints).toHaveBeenCalled()
    expect(inventoryAdd).toHaveBeenCalled()
  })

  it("新站訂單不受影響，發票照常排入", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "orders") {
        return chain({ data: { ...ORDER, order_number: "10000168" }, error: null }) as any
      }
      return chain({ data: null, error: null }) as any
    })

    await enqueuePostPaymentJobs("o-1", { silent: true })

    expect(invoiceAdd).toHaveBeenCalled()
  })
})
