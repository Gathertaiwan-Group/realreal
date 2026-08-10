/**
 * 電子發票開立的冪等性測試。
 *
 * 這些測試要證明的不是「大部分時候不會重複開票」，而是「重複開票在結構上做不到」。
 * 所以它們不 mock 掉 claim 邏輯 —— 那樣只會測到 mock。取而代之的是 FakeInvoiceDb：
 * 一份 migration 0049 裡 claim_invoice_issue / finish_invoice_issue /
 * fail_invoice_issue / reclaim_stale_invoices 的逐條轉寫。
 *
 * 兩個讓它有意義的性質：
 *
 *   * 原子性：每個 RPC 的函式主體都是**同步**的（沒有 await），所以 JS 的單執行緒
 *     語意等同於 SQL 的「同一個交易 + 訂單列鎖」。兩個並行的 job 不可能觀察到彼此
 *     的中間狀態，正如兩個並行的 PostgreSQL 交易不可能。
 *   * 可證偽：把 claim 拿掉（退回改版前的 read-then-act），第 3 與第 4 組測試會立刻
 *     變紅——它們數的是 issueInvoice 這個不可逆副作用被呼叫了幾次。
 *
 * amegoLedger 模擬 Amego 那邊的 OrderId 唯一性：同一個 OrderId 第二次開立會拿到
 * 3040171，正如真的 Amego（已對測試環境 統編 12345678 實測）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock("../amego", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../amego")>()
  return {
    ...actual,
    issueInvoice: vi.fn(),
    findInvoiceByOrderId: vi.fn(),
  }
})

import { supabase } from "../supabase"
import {
  AMEGO_CODE_DUPLICATE_ORDER,
  AmegoError,
  findInvoiceByOrderId,
  issueInvoice,
} from "../amego"
import { runInvoiceIssueJob } from "../issue-invoice"

const ORDER_ID = "00000000-0000-0000-0000-00000000o001".replace("o", "0")
const INVOICE_ID = "00000000-0000-0000-0000-0000000000i1".replace("i", "1")
const ORDER_NUMBER = "10000050"
const STALE_MS = 10 * 60 * 1000

interface InvoiceRow {
  id: string
  order_id: string
  status: "pending" | "issuing" | "issued" | "voided"
  invoice_number: string | null
  random_code: string | null
  amego_id: string | null
  issued_at: string | null
  error_message: string | null
  retry_count: number
  issue_attempts: number
  locked_at: number | null
  amount: number
  tax_amount: number
  type: string
  carrier_type: string | null
  carrier_number: string | null
  love_code: string | null
  tax_id: string | null
  company_title: string | null
}

/** A transliteration of migration 0049's plpgsql, plus a settable clock. */
class FakeInvoiceDb {
  invoices = new Map<string, InvoiceRow>()
  orders = new Map<string, { order_number: string; order_items: any[] }>()
  clock = 1_000_000
  /** When frozen, every write RPC fails — models a SIGKILLed process. */
  frozen = false
  /**
   * Makes only finish_invoice_issue fail — models a transient PostgREST error on
   * the success write while the DB is otherwise reachable. Distinct from
   * `frozen`: here the fail_invoice_issue path CAN run, which is exactly what
   * makes "we must not mark it pending" observable.
   */
  failNextFinish = false

  seedInvoice(over: Partial<InvoiceRow> = {}): InvoiceRow {
    const row: InvoiceRow = {
      id: INVOICE_ID,
      order_id: ORDER_ID,
      status: "pending",
      invoice_number: null,
      random_code: null,
      amego_id: null,
      issued_at: null,
      error_message: null,
      retry_count: 0,
      issue_attempts: 0,
      locked_at: null,
      amount: 1650,
      tax_amount: 0,
      type: "B2C_2",
      carrier_type: null,
      carrier_number: null,
      love_code: null,
      tax_id: null,
      company_title: null,
      ...over,
    }
    this.invoices.set(row.id, row)
    this.orders.set(row.order_id, {
      order_number: ORDER_NUMBER,
      order_items: [{ qty: 1, unit_price: 1650, product_snapshot: { name: "禮盒" } }],
    })
    return row
  }

  private claimRow(
    claimed: boolean,
    reason: string,
    inv: InvoiceRow | null,
    orderNumber: string | null,
    attemptOverride?: number,
  ) {
    return [
      {
        claimed,
        reason,
        invoice_id: inv?.id ?? null,
        order_id: inv?.order_id ?? null,
        attempt: attemptOverride ?? inv?.issue_attempts ?? 0,
        order_number: orderNumber,
        invoice_number: inv?.invoice_number ?? null,
      },
    ]
  }

  // --- claim_invoice_issue -------------------------------------------------
  // SYNCHRONOUS on purpose: this models "one transaction, order row locked".
  claim(args: any) {
    const maxRetries = args.p_max_retries ?? 10
    let orderId: string | null = args.p_order_id ?? null
    if (!orderId) {
      const byId = this.invoices.get(args.p_invoice_id)
      if (!byId) return this.claimRow(false, "invoice_not_found", null, null)
      orderId = byId.order_id
    }
    const order = this.orders.get(orderId)
    if (!order) return this.claimRow(false, "invoice_not_found", null, null)

    const all = [...this.invoices.values()].filter((i) => i.order_id === orderId)

    // Any issued row for this order wins — never open a second one.
    const issued = all.filter((i) => i.status === "issued").sort((a, b) => a.id.localeCompare(b.id))[0]
    if (issued) return this.claimRow(false, "already_issued", issued, order.order_number)

    const inv = args.p_invoice_id
      ? this.invoices.get(args.p_invoice_id)
      : all
          .filter((i) => i.status !== "voided")
          .sort(
            (a, b) =>
              Number(b.status === "issuing") - Number(a.status === "issuing") ||
              a.id.localeCompare(b.id),
          )[0]

    if (!inv) return this.claimRow(false, "invoice_not_found", null, order.order_number)
    if (inv.status === "voided") return this.claimRow(false, "voided", inv, order.order_number)
    if ((inv.retry_count ?? 0) >= maxRetries)
      return this.claimRow(false, "retries_exhausted", inv, order.order_number)

    const stale = inv.locked_at === null || inv.locked_at < this.clock - STALE_MS
    const claimable = inv.status === "pending" || (inv.status === "issuing" && stale)
    if (!claimable) return this.claimRow(false, "locked", inv, order.order_number, 0)

    inv.status = "issuing"
    inv.locked_at = this.clock
    inv.issue_attempts += 1
    inv.error_message = null
    return this.claimRow(true, "claimed", inv, order.order_number)
  }

  finish(args: any) {
    const inv = this.invoices.get(args.p_invoice_id)
    if (!inv) throw new Error(`INVOICE_ROW_MISSING:${args.p_invoice_id}`)

    const other = [...this.invoices.values()].find(
      (i) =>
        i.order_id === inv.order_id &&
        i.id !== inv.id &&
        i.status === "issued" &&
        i.invoice_number !== args.p_invoice_number,
    )
    if (other) {
      throw new Error(
        `DOUBLE_ISSUE:order=${inv.order_id} existing=${other.invoice_number} incoming=${args.p_invoice_number}`,
      )
    }
    if (inv.status === "issued") {
      if (inv.invoice_number !== args.p_invoice_number) {
        throw new Error(
          `DOUBLE_ISSUE:invoice=${inv.id} existing=${inv.invoice_number} incoming=${args.p_invoice_number}`,
        )
      }
      return false
    }
    inv.status = "issued"
    inv.invoice_number = args.p_invoice_number
    inv.random_code = args.p_random_code ?? inv.random_code
    inv.amego_id = args.p_amego_id ?? args.p_invoice_number
    inv.issued_at = new Date(this.clock).toISOString()
    inv.error_message = null
    inv.locked_at = null
    inv.retry_count = 0
    return true
  }

  fail(args: any) {
    const inv = this.invoices.get(args.p_invoice_id)
    if (!inv || inv.status === "issued") return -1
    inv.status = "pending"
    inv.locked_at = null
    inv.error_message = String(args.p_error ?? "unknown").slice(0, 500)
    inv.retry_count = args.p_permanent
      ? Math.max(inv.retry_count + 1, args.p_max_retries ?? 10)
      : inv.retry_count + 1
    return inv.retry_count
  }

  reclaim(args: any) {
    const staleAfter = args?.p_stale_after_ms ?? STALE_MS
    const out: any[] = []
    for (const inv of this.invoices.values()) {
      if (inv.status !== "issuing") continue
      if (!(inv.locked_at === null || inv.locked_at < this.clock - staleAfter)) continue
      out.push({
        invoice_id: inv.id,
        order_id: inv.order_id,
        stuck_since: inv.locked_at,
        attempts: inv.issue_attempts,
      })
      inv.status = "pending"
      inv.locked_at = null
      inv.error_message = "stale_issuing_reclaimed"
    }
    return out
  }

  install() {
    vi.mocked(supabase.rpc).mockImplementation((fn: string, args: any) => {
      if (this.frozen && fn !== "claim_invoice_issue") {
        return Promise.resolve({ data: null, error: { message: "process killed" } }) as any
      }
      try {
        switch (fn) {
          case "claim_invoice_issue":
            return Promise.resolve({ data: this.claim(args), error: null }) as any
          case "finish_invoice_issue":
            if (this.failNextFinish) {
              this.failNextFinish = false
              return Promise.resolve({
                data: null,
                error: { message: "could not connect to server" },
              }) as any
            }
            return Promise.resolve({ data: this.finish(args), error: null }) as any
          case "fail_invoice_issue":
            return Promise.resolve({ data: this.fail(args), error: null }) as any
          case "reclaim_stale_invoices":
            return Promise.resolve({ data: this.reclaim(args), error: null }) as any
          default:
            return Promise.resolve({ data: null, error: { message: `unknown rpc ${fn}` } }) as any
        }
      } catch (err: any) {
        // plpgsql RAISE surfaces as a PostgREST error, not a thrown JS error.
        return Promise.resolve({ data: null, error: { message: err.message } }) as any
      }
    })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn((_col: string, val: string) => {
          chain._id = val
          return chain
        }),
        single: vi.fn(async () => {
          if (table !== "invoices") return { data: null, error: null }
          const inv = this.invoices.get(chain._id)
          if (!inv) return { data: null, error: { message: "not found" } }
          return { data: { ...inv, orders: this.orders.get(inv.order_id) }, error: null }
        }),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      }
      return chain
    })
  }
}

/**
 * Models Amego: OrderId is unique, so a second issue for the same OrderId is
 * rejected with 3040171 rather than producing a second invoice.
 */
class FakeAmego {
  byOrderId = new Map<string, { invoiceNumber: string; randomNumber: string }>()
  issueCalls: string[] = []
  private seq = 0

  install() {
    vi.mocked(issueInvoice).mockImplementation(async (params: any) => {
      const key = params.orderNumber || params.orderId
      this.issueCalls.push(key)
      if (this.byOrderId.has(key)) {
        throw new AmegoError("Amego issue failed: OrderId 重複", AMEGO_CODE_DUPLICATE_ORDER)
      }
      const rec = {
        invoiceNumber: `ZA${String(10000000 + ++this.seq)}`,
        randomNumber: "1618",
      }
      this.byOrderId.set(key, rec)
      return { invoiceNumber: rec.invoiceNumber, randomCode: rec.randomNumber, amegoId: rec.invoiceNumber }
    })

    vi.mocked(findInvoiceByOrderId).mockImplementation(async (orderId: string) => {
      const rec = this.byOrderId.get(orderId)
      if (!rec) return { ok: true, hit: null }
      return {
        ok: true,
        hit: {
          invoiceNumber: rec.invoiceNumber,
          randomNumber: rec.randomNumber,
          totalAmount: 1650,
          pendingVoid: false,
        },
      }
    })
  }
}

let db: FakeInvoiceDb
let amego: FakeAmego

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeInvoiceDb()
  amego = new FakeAmego()
  db.install()
  amego.install()
})

describe("1) 正常開立", () => {
  it("claim → 開立 → 記錄，只送出一次，且第一次不做反查", async () => {
    db.seedInvoice()

    const res = await runInvoiceIssueJob({ orderId: ORDER_ID })

    expect(res).toMatchObject({ ok: true, adopted: false })
    expect(amego.issueCalls).toHaveLength(1)
    // attempt === 1 → no round trip wasted on a lookup that cannot find anything
    expect(findInvoiceByOrderId).not.toHaveBeenCalled()

    const row = db.invoices.get(INVOICE_ID)!
    expect(row.status).toBe("issued")
    expect(row.invoice_number).toBe("ZA10000001")
    expect(row.issue_attempts).toBe(1)
  })
})

describe("2) Amego 已開出但我們沒記到 → 反查認回", () => {
  it("重試時認回既有發票，全程只送出一次開立請求", async () => {
    db.seedInvoice()

    // 第一次：開出去了，然後行程被殺（frozen = 之後任何 DB 寫入都不會發生）
    db.frozen = true
    await expect(runInvoiceIssueJob({ orderId: ORDER_ID })).rejects.toThrow(/persist failed/)
    db.frozen = false

    // SIGKILL 之後的真實狀態：Amego 有一張、我們的 DB 停在 issuing、沒有發票號碼
    const midway = db.invoices.get(INVOICE_ID)!
    expect(midway.status).toBe("issuing")
    expect(midway.invoice_number).toBeNull()
    expect(amego.byOrderId.has(ORDER_NUMBER)).toBe(true)
    expect(amego.issueCalls).toHaveLength(1)

    // 過了 stale 窗口，claim 接手重試
    db.clock += STALE_MS + 1000
    const res = await runInvoiceIssueJob({ orderId: ORDER_ID })

    expect(res).toMatchObject({ ok: true, adopted: true })
    // ★ 核心斷言：開立請求全程只送出一次
    expect(amego.issueCalls).toHaveLength(1)
    expect(findInvoiceByOrderId).toHaveBeenCalledWith(ORDER_NUMBER)

    const row = db.invoices.get(INVOICE_ID)!
    expect(row.status).toBe("issued")
    expect(row.invoice_number).toBe("ZA10000001") // 認回的是同一張，不是新的
  })

  it("反查掛掉時，仍靠 Amego 的 OrderId 唯一性（3040171）認回，不會產生第二張", async () => {
    db.seedInvoice()
    db.frozen = true
    await expect(runInvoiceIssueJob({ orderId: ORDER_ID })).rejects.toThrow()
    db.frozen = false
    db.clock += STALE_MS + 1000

    // 反查這一道保險故意壞掉（IP 白名單／簽章錯／逾時都會長這樣）
    vi.mocked(findInvoiceByOrderId).mockResolvedValueOnce({ ok: false, msg: "code=16 sign error" })

    const res = await runInvoiceIssueJob({ orderId: ORDER_ID })

    expect(res).toMatchObject({ ok: true, adopted: true })
    // 第二次 issueInvoice 有被送出，但 Amego 用 3040171 擋下來 → 沒有第二張發票
    expect(amego.issueCalls).toHaveLength(2)
    expect(amego.byOrderId.size).toBe(1)
    expect(db.invoices.get(INVOICE_ID)!.invoice_number).toBe("ZA10000001")
  })
})

describe("3) 併發：同一張訂單同時觸發兩次", () => {
  it("只有一次真的送出開立請求", async () => {
    db.seedInvoice()

    const [a, b] = await Promise.all([
      runInvoiceIssueJob({ orderId: ORDER_ID }),
      runInvoiceIssueJob({ invoiceId: INVOICE_ID }),
    ])

    // ★ 核心斷言
    expect(amego.issueCalls).toHaveLength(1)
    expect(amego.byOrderId.size).toBe(1)

    const results = [a, b]
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const skipped = results.find((r) => !r.ok) as any
    expect(["locked", "already_issued"]).toContain(skipped.reason)
    expect(db.invoices.get(INVOICE_ID)!.status).toBe("issued")
  })

  it("五個並行（模擬 admin 連按 + webhook 重送）也只送出一次", async () => {
    db.seedInvoice()

    const results = await Promise.all(
      Array.from({ length: 5 }, () => runInvoiceIssueJob({ orderId: ORDER_ID })),
    )

    expect(amego.issueCalls).toHaveLength(1)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })
})

describe("4) 已開立之後的任何重跑都不會再開", () => {
  it("已 issued 的訂單重跑 → already_issued，不碰 Amego", async () => {
    db.seedInvoice()
    await runInvoiceIssueJob({ orderId: ORDER_ID })
    expect(amego.issueCalls).toHaveLength(1)

    const again = await runInvoiceIssueJob({ orderId: ORDER_ID })

    expect(again).toMatchObject({ ok: false, skipped: true, reason: "already_issued" })
    expect(amego.issueCalls).toHaveLength(1)
    expect((again as any).invoiceNumber).toBe("ZA10000001")
  })

  it("同一訂單的另一列 invoice 也不會被拿來開第二張", async () => {
    db.seedInvoice()
    await runInvoiceIssueJob({ orderId: ORDER_ID })

    // 沒有 unique constraint 的世界裡，read-then-insert 可能多插一列
    const second = { ...db.invoices.get(INVOICE_ID)! }
    second.id = "00000000-0000-0000-0000-000000000002"
    second.status = "pending"
    second.invoice_number = null
    second.issue_attempts = 0
    second.retry_count = 0
    db.invoices.set(second.id, second)

    const res = await runInvoiceIssueJob({ invoiceId: second.id })

    expect(res).toMatchObject({ ok: false, reason: "already_issued" })
    expect(amego.issueCalls).toHaveLength(1)
  })
})

describe("5) 卡在 issuing 的可以被回收，不會永久卡住", () => {
  it("reclaim_stale_invoices 把過期的 issuing 撥回 pending 並留下痕跡", async () => {
    const row = db.seedInvoice({ status: "issuing", locked_at: 0, issue_attempts: 2 })

    const reclaimed = db.reclaim({})

    expect(reclaimed).toHaveLength(1)
    expect(row.status).toBe("pending")
    expect(row.error_message).toBe("stale_issuing_reclaimed")
    // ★ issue_attempts 撐過回收 —— 下次重試一定會先反查
    expect(row.issue_attempts).toBe(2)
  })

  it("還沒過期的 issuing 不會被搶走", () => {
    const row = db.seedInvoice({ status: "issuing", locked_at: db.clock })
    expect(db.reclaim({})).toHaveLength(0)
    expect(row.status).toBe("issuing")
  })

  it("回收後重試會走反查認回，而不是重開", async () => {
    db.seedInvoice()
    db.frozen = true
    await expect(runInvoiceIssueJob({ orderId: ORDER_ID })).rejects.toThrow()
    db.frozen = false

    db.clock += STALE_MS + 1000
    expect(db.reclaim({})).toHaveLength(1)
    expect(db.invoices.get(INVOICE_ID)!.status).toBe("pending")

    const res = await runInvoiceIssueJob({ invoiceId: INVOICE_ID })

    expect(res).toMatchObject({ ok: true, adopted: true })
    expect(amego.issueCalls).toHaveLength(1)
  })
})

describe("6) 失敗路徑", () => {
  it("Amego 真的失敗 → 退回 pending、retry_count+1、錯誤留在列上，且 job 會拋讓 BullMQ 重試", async () => {
    db.seedInvoice()
    vi.mocked(issueInvoice).mockRejectedValueOnce(new AmegoError("Amego issue failed: 系統忙碌", 99))

    await expect(runInvoiceIssueJob({ orderId: ORDER_ID })).rejects.toThrow(/系統忙碌/)

    const row = db.invoices.get(INVOICE_ID)!
    expect(row.status).toBe("pending")
    expect(row.retry_count).toBe(1)
    expect(row.issue_attempts).toBe(1) // 送出過就是送出過，不歸零
    expect(row.error_message).toMatch(/系統忙碌/)
  })

  it("retry_count 到上限 → retries_exhausted，不再自動打 Amego", async () => {
    db.seedInvoice({ retry_count: 10 })

    const res = await runInvoiceIssueJob({ orderId: ORDER_ID })

    expect(res).toMatchObject({ ok: false, reason: "retries_exhausted" })
    expect(amego.issueCalls).toHaveLength(0)
  })

  it("已開立但寫回失敗（行程被殺）→ 留在 issuing，避免被當成沒開過", async () => {
    db.seedInvoice()
    db.frozen = true

    await expect(runInvoiceIssueJob({ orderId: ORDER_ID })).rejects.toThrow(
      /issued at Amego .* but DB persist failed/,
    )

    expect(db.invoices.get(INVOICE_ID)!.status).toBe("issuing")
  })

  it("已開立但寫回失敗（DB 還活著）→ **不可以**呼叫 fail 把它退回 pending", async () => {
    db.seedInvoice()
    // 只有 finish 這一次失敗；fail_invoice_issue 是打得通的 —— 所以「有沒有退回
    // pending」在這裡是看得見的差別。退回 pending 等於對一張已經開出去的真發票
    // 宣告「還沒開過」，下一輪就會再開一張。
    db.failNextFinish = true

    await expect(runInvoiceIssueJob({ orderId: ORDER_ID })).rejects.toThrow(
      /issued at Amego .* but DB persist failed/,
    )

    const row = db.invoices.get(INVOICE_ID)!
    expect(row.status).toBe("issuing")
    expect(row.retry_count).toBe(0)
    expect(amego.byOrderId.has(ORDER_NUMBER)).toBe(true)

    // 而且後續回收重試會認回，不會開第二張
    db.clock += STALE_MS + 1000
    const res = await runInvoiceIssueJob({ orderId: ORDER_ID })
    expect(res).toMatchObject({ ok: true, adopted: true })
    expect(amego.issueCalls).toHaveLength(1)
  })

  it("voided 的發票不會被自動重開", async () => {
    db.seedInvoice({ status: "voided" })

    const res = await runInvoiceIssueJob({ invoiceId: INVOICE_ID })

    expect(res).toMatchObject({ ok: false, reason: "voided" })
    expect(amego.issueCalls).toHaveLength(0)
  })

  it("finish 時發現同訂單已有別的號碼 → DOUBLE_ISSUE 絆線響起", async () => {
    db.seedInvoice()
    await runInvoiceIssueJob({ orderId: ORDER_ID })

    const stray = { ...db.invoices.get(INVOICE_ID)! }
    stray.id = "00000000-0000-0000-0000-000000000003"
    stray.status = "issuing"
    stray.invoice_number = null
    db.invoices.set(stray.id, stray)

    await expect(
      supabase.rpc("finish_invoice_issue", {
        p_invoice_id: stray.id,
        p_invoice_number: "ZA99999999",
      } as any),
    ).resolves.toMatchObject({ error: { message: expect.stringContaining("DOUBLE_ISSUE") } })
  })
})

describe("7) job 資料形狀", () => {
  it("兩個 producer 的 payload 都吃（orderId / invoiceId）", async () => {
    db.seedInvoice()
    await expect(runInvoiceIssueJob({ invoiceId: INVOICE_ID })).resolves.toMatchObject({ ok: true })
  })

  it("兩個都沒給就拋", async () => {
    await expect(runInvoiceIssueJob({})).rejects.toThrow(/must include invoiceId or orderId/)
  })
})
