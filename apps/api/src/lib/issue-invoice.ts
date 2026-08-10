/**
 * 開發票的編排層：claim → 反查 → 打 Amego → 記結果。
 *
 * ── 為什麼 claim 一定要在打 Amego 之前 ─────────────────────────────────────
 * 發票開出去撤不回來。財政部那邊多一張就是多一張，只能再開一張作廢單去沖銷，而客人
 * 的信箱裡已經躺著兩份稅務憑證。所以順序是硬性的：
 *
 *   1. claim_invoice_issue()  原子地宣告「這張由我開」（migration 0049 的兩道閘門）
 *   2. 呼叫 Amego             只有拿到 claim 的人可以做這一步
 *   3. finish / fail          一定要走到其中一個
 *
 * 這個順序讓「已送出但還沒記錄」在資料庫裡**看得見**（status='issuing'）。改版前那
 * 段是完全沒有痕跡的空白：從 Amego 回應到 UPDATE 落地之間行程被殺，資料庫裡這張單
 * 還是 pending，於是兩道守門（worker 的 .neq("status","issued") 與早退檢查）全部
 * 放行，下一次重試就開出第二張真發票。
 *
 * ── 重試前先問「是不是已經開過了」───────────────────────────────────────
 * 第 2 步與第 3 步之間如果行程被砍掉，狀態是「Amego 已經開了，我們沒記到」。這一種
 * **一定**要用 findInvoiceByOrderId() 認回來，而不是重開一張。判斷依據是
 * `issue_attempts > 1`（claim 遞增、永不歸零）；刻意不用 retry_count，因為它成功時
 * 會被重設為 0，正好在最需要反查的那一次選擇不反查。
 *
 * 兩道獨立的保險，互為 fallback：
 *   主動  invoice_query（type:"order"）查得到號碼 → 認回
 *   被動  c0401 回 3040171（OrderId 重複）→ 回頭查一次再認回
 * 任何一道掛掉，另一道還在。兩道都成立的前提是 OrderId = orders.order_number
 * （TEXT UNIQUE），也就是把 Amego 那邊的唯一性約束借來當我們的冪等鍵。
 */
import { supabase } from "./supabase"
import {
  AMEGO_CODE_DUPLICATE_ORDER,
  AmegoError,
  findInvoiceByOrderId,
  issueInvoice,
  type IssueInvoiceParams,
} from "./amego"

export interface IssueInvoiceJobData {
  invoiceId?: string
  orderId?: string
}

export type IssueInvoiceResult =
  | { ok: true; invoiceId: string; invoiceNumber: string; adopted: boolean }
  | { ok: false; skipped: true; reason: string; invoiceId?: string; invoiceNumber?: string }

interface ClaimRow {
  claimed: boolean
  reason: string
  invoice_id: string | null
  order_id: string | null
  attempt: number
  order_number: string | null
  invoice_number: string | null
}

/**
 * Reasons the claim was refused that are NOT failures — someone else is issuing,
 * or there is nothing left to do. Returning (rather than throwing) keeps BullMQ
 * from retrying a job whose work is already done or already owned.
 */
const BENIGN_CLAIM_REASONS = new Set([
  "already_issued",
  "locked",
  "voided",
  "retries_exhausted",
  "invoice_not_found",
])

/**
 * 開一張發票。拿到 claim 之後，每一條路徑都必須走到 finish 或 fail。
 *
 * Throws on failures that deserve a BullMQ retry; returns `{ ok:false,
 * skipped:true }` when there is legitimately nothing to do.
 */
export async function runInvoiceIssueJob(
  data: IssueInvoiceJobData,
): Promise<IssueInvoiceResult> {
  if (!data.invoiceId && !data.orderId) {
    throw new Error("Job data must include invoiceId or orderId")
  }

  // ---- 1) claim ------------------------------------------------------------
  // 這一步取代了改版前的「先 select 挑一列非 issued 的、再往下做」。那個 read-then-act
  // 之所以擋不住重複，是因為它讀到的永遠是 persist 後的狀態；claim 是原子的 CAS。
  const { data: claimRows, error: claimErr } = await supabase.rpc("claim_invoice_issue", {
    p_order_id: data.orderId ?? null,
    p_invoice_id: data.invoiceId ?? null,
  })

  if (claimErr) {
    // PGRST202 = the function does not exist, i.e. migration 0049 has not been
    // applied to this database yet. Fail CLOSED and say so: refusing to issue is
    // always recoverable (the row stays pending and can be re-driven), whereas
    // falling back to the old un-claimed path would re-open the double-issue
    // window this module exists to close. Never add such a fallback.
    const hint =
      claimErr.code === "PGRST202" || /claim_invoice_issue/.test(claimErr.message ?? "")
        ? " — 資料庫還沒套用 packages/db/migrations/0049_invoice_issue_claim.sql。" +
          "請先在 Supabase SQL Editor 執行該檔，開票才會恢復（在那之前發票只會留在 pending，不會重複開立）。"
        : ""
    throw new Error(`claim_invoice_issue failed: ${claimErr.message}${hint}`)
  }

  const claim: ClaimRow | undefined = Array.isArray(claimRows) ? claimRows[0] : (claimRows as any)
  if (!claim) {
    throw new Error("claim_invoice_issue returned no row")
  }

  if (!claim.claimed) {
    if (BENIGN_CLAIM_REASONS.has(claim.reason)) {
      return {
        ok: false,
        skipped: true,
        reason: claim.reason,
        invoiceId: claim.invoice_id ?? undefined,
        invoiceNumber: claim.invoice_number ?? undefined,
      }
    }
    throw new Error(`Invoice claim refused: ${claim.reason}`)
  }

  const invoiceId = claim.invoice_id!
  const attempt = Number(claim.attempt ?? 1)

  // 拿到 claim 之後，任何離開這個函式的路徑都必須先 finish 或 fail，否則這一列會
  // 卡在 issuing 直到 reclaim_stale_invoices 把它撿回來。
  try {
    return await issueWithClaim(invoiceId, attempt, claim.order_number)
  } catch (err: any) {
    if (err instanceof IssuedButNotRecordedError) {
      // 發票**真的**開出去了，只是我們沒記成功。絕不可以標成 pending 讓它被重開：
      // 留在 issuing，等 reclaim 撿回來，那時 issue_attempts>1 會觸發反查認回。
      throw err
    }
    await failInvoice(invoiceId, err?.message ?? String(err))
    throw err
  }
}

/** 已開立但寫回資料庫失敗 —— 唯一不可以呼叫 fail_invoice_issue 的錯誤。 */
export class IssuedButNotRecordedError extends Error {
  constructor(
    message: string,
    readonly invoiceNumber: string,
  ) {
    super(message)
    this.name = "IssuedButNotRecordedError"
  }
}

async function failInvoice(invoiceId: string, message: string, permanent = false) {
  const { error } = await supabase.rpc("fail_invoice_issue", {
    p_invoice_id: invoiceId,
    p_error: message,
    p_permanent: permanent,
  })
  if (error) {
    // Losing the failure record is bad but must not mask the original error.
    console.error(`[invoice] fail_invoice_issue failed for ${invoiceId}: ${error.message}`)
  }
}

/**
 * Records a successful issue (or an adoption). Throws IssuedButNotRecordedError
 * when the write fails, because at that point a real e-invoice exists.
 */
async function finishInvoice(
  invoiceId: string,
  invoiceNumber: string,
  randomCode: string | null,
  amegoId: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("finish_invoice_issue", {
    p_invoice_id: invoiceId,
    p_invoice_number: invoiceNumber,
    p_random_code: randomCode,
    p_amego_id: amegoId,
  })
  if (error) {
    throw new IssuedButNotRecordedError(
      `Invoice ${invoiceId} issued at Amego (number ${invoiceNumber}) but DB persist failed: ${error.message}`,
      invoiceNumber,
    )
  }
}

async function issueWithClaim(
  invoiceId: string,
  attempt: number,
  claimedOrderNumber: string | null,
): Promise<IssueInvoiceResult> {
  // Disambiguate the orders embed — there are TWO FKs between invoices and
  // orders (orders.invoice_id → invoices.id, and invoices.order_id → orders.id).
  // Without the hint PostgREST returns PGRST201 and the select silently 0s.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select(
      "*, orders!invoices_order_id_fkey(order_number, total, user_id, order_items(qty, unit_price, product_snapshot))",
    )
    .eq("id", invoiceId)
    .single()

  if (invErr) throw new Error(`Invoice lookup failed: ${invErr.message}`)
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`)

  const order = (invoice as any).orders as any
  const orderNumber: string = order?.order_number ?? claimedOrderNumber ?? ""

  // ---- 2) 重試前先問 Amego：上一次是不是其實開成功了 ------------------------
  // attempt > 1 才問（第一次開票沒有「上一次」，不需要多一次往返）。
  // 這是「Amego 開了但我們沒記到」唯一的解法。
  if (attempt > 1 && orderNumber) {
    const found = await findInvoiceByOrderId(orderNumber)
    if (found.ok && found.hit?.invoiceNumber) {
      console.warn(
        `[invoice] order=${orderNumber} 上一次其實已經開成功（${found.hit.invoiceNumber}），認回不重開`,
      )
      await finishInvoice(
        invoiceId,
        found.hit.invoiceNumber,
        found.hit.randomNumber || null,
        found.hit.invoiceNumber,
      )
      return { ok: true, invoiceId, invoiceNumber: found.hit.invoiceNumber, adopted: true }
    }
    if (!found.ok) {
      // 查不出來不代表沒開過。不阻斷流程，但接下來要靠 Amego 自己的 OrderId
      // 唯一性（3040171）當第二道保險 —— 見下面的 catch。
      console.warn(
        `[invoice] order=${orderNumber} 重試前反查失敗（${found.msg}），改靠 OrderId 唯一性`,
      )
    }
  }

  // Build line items from the order (name lives in product_snapshot JSON)
  const items: IssueInvoiceParams["items"] = Array.isArray(order?.order_items)
    ? order.order_items.map((item: any) => ({
        name: (item.product_snapshot?.name as string) ?? "商品",
        qty: Number(item.qty),
        unitPrice: Number(item.unit_price),
      }))
    : []

  // ---- 3) 真的開 -----------------------------------------------------------
  let result: Awaited<ReturnType<typeof issueInvoice>>
  try {
    result = await issueInvoice({
      orderId: (invoice as any).order_id,
      orderNumber,
      amount: Number((invoice as any).amount),
      taxAmount: Number((invoice as any).tax_amount),
      type: (invoice as any).type,
      carrierType: (invoice as any).carrier_type,
      carrierNumber: (invoice as any).carrier_number ?? undefined,
      loveCode: (invoice as any).love_code ?? undefined,
      taxId: (invoice as any).tax_id ?? undefined,
      companyTitle: (invoice as any).company_title ?? undefined,
      items,
    })
  } catch (err: any) {
    // OrderId 重複 = 這張訂單已經開過了。這是冪等訊號，不是失敗：查回來認領。
    // 反查那一關失敗時（或第一次開票根本沒反查），這裡是最後一道保險。
    if (err instanceof AmegoError && err.code === AMEGO_CODE_DUPLICATE_ORDER && orderNumber) {
      const found = await findInvoiceByOrderId(orderNumber)
      if (found.ok && found.hit?.invoiceNumber) {
        console.warn(
          `[invoice] order=${orderNumber} OrderId 重複，認回既有發票 ${found.hit.invoiceNumber}`,
        )
        await finishInvoice(
          invoiceId,
          found.hit.invoiceNumber,
          found.hit.randomNumber || null,
          found.hit.invoiceNumber,
        )
        return { ok: true, invoiceId, invoiceNumber: found.hit.invoiceNumber, adopted: true }
      }
    }
    throw err
  }

  // ---- 4) 記結果 -----------------------------------------------------------
  await finishInvoice(invoiceId, result.invoiceNumber, result.randomCode || null, result.amegoId)
  return { ok: true, invoiceId, invoiceNumber: result.invoiceNumber, adopted: false }
}
