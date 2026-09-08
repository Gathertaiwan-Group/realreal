/**
 * 逾時未付款自動取消 —— 每小時掃一次。
 *
 * 為什麼需要這支：線上付款的訂單如果客人沒付就離開，會永遠停在「待付款」。
 * 那不只是清單愈積愈長的問題 —— 這種訂單會一直佔住該會員的首購資格
 * （isFirstPurchase 會把「待付款且 first_purchase_applied=true」視為已使用，
 * 否則同一個人可以連下五筆待付款訂單、每筆都折 50）。結果是客人重新下單時
 * 折扣憑空消失，而且他不會知道為什麼。#10000071 的客人就這樣多付了 50 元。
 *
 * 取消一律走 cancelOrderById：它會還原庫存、退回點數、釋放首購資格，而且
 * 不會寄任何信給客人（6 小時的未付款提醒信是另一支工作，早就寄過了）。
 *
 * 三道保護，因為這支程式會自動改動客人的訂單：
 *   1. 只碰線上付款（linepay / jkopay / pchomepay）。貨到付款在取貨前本來就是
 *      待付款，通路商訂單的 payment_method 是 NULL —— 兩者都不在名單內。
 *   2. 只碰 order_type='retail'。
 *   3. 單次上限 MAX_PER_RUN 筆；掃到上限就停手並回報，寧可下個小時再繼續，
 *      也不要在查詢寫錯時一口氣掃掉整個資料表。
 *
 * 封存（deleted_at）的訂單「也要」掃 —— 那是刻意的，不是漏掉。後台封存只是把
 * 訂單藏起來，status 還是 pending，首購資格照樣被佔著。#10000071 在 2026-08-02
 * 被封存，那位客人的 50 元卻一路被吃到今天，畫面上還完全看不出原因。一筆已經
 * 封存又沒付款的訂單，不可能再被付款。
 */
import { Worker, Queue } from "bullmq"
import { Redis } from "ioredis"
import * as Sentry from "@sentry/node"
import { supabase } from "../lib/supabase"
import { cancelOrderById } from "../lib/cancel-order"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
})

export const expireUnpaidOrdersQueue = new Queue("expire-unpaid-orders", { connection })

/** 只有這三種付款方式是「客人當下就該付掉」的。 */
const ONLINE_METHODS = ["linepay", "jkopay", "pchomepay"] as const

/** 給客人多久付款。改這個值就改政策。 */
export const UNPAID_GRACE_HOURS = Number(process.env.UNPAID_ORDER_GRACE_HOURS ?? 24)

/** 單次掃描上限 —— 防呆，不是效能考量。 */
const MAX_PER_RUN = 50

export function cutoffIso(now: Date, graceHours = UNPAID_GRACE_HOURS): string {
  return new Date(now.getTime() - graceHours * 60 * 60 * 1000).toISOString()
}

export type ExpireSummary = {
  found: number
  cancelled: number
  failed: number
  cappedAt: number | null
  orderNumbers: string[]
}

export async function expireUnpaidOrders(now = new Date()): Promise<ExpireSummary> {
  const cutoff = cutoffIso(now)

  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, total, created_at")
    .eq("status", "pending")
    .neq("payment_status", "paid")
    .eq("order_type", "retail")
    .in("payment_method", ONLINE_METHODS as unknown as string[])
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN + 1)

  if (error) throw new Error(`expire-unpaid-orders query failed: ${error.message}`)

  const rows = data ?? []
  const capped = rows.length > MAX_PER_RUN
  const batch = capped ? rows.slice(0, MAX_PER_RUN) : rows

  let cancelled = 0
  let failed = 0
  const orderNumbers: string[] = []

  for (const row of batch) {
    try {
      const r = await cancelOrderById(row.id as string, `逾期未付款（超過 ${UNPAID_GRACE_HOURS} 小時）`, {
        allowedStatuses: ["pending"],
      })
      if (r.result === "cancelled") {
        cancelled++
        orderNumbers.push(row.order_number as string)
      } else {
        // 已經被別的流程處理掉了（客人剛好付款、或後台手動取消）——不是錯誤。
        console.log(`[expire-unpaid-orders] ${row.order_number} 跳過：${r.result}`)
      }
    } catch (err) {
      failed++
      console.error(`[expire-unpaid-orders] ${row.order_number} 取消失敗：`, err)
      Sentry.captureException(err, {
        tags: { component: "expire-unpaid-orders" },
        extra: { orderNumber: row.order_number },
      })
    }
  }

  if (capped) {
    // 正常情況一小時內不可能有 50 筆逾期訂單。掃到上限多半代表查詢條件寫錯了，
    // 或是有一批訂單同時卡住 —— 兩種都該有人看一眼。
    Sentry.captureMessage(
      `[expire-unpaid-orders] 單次掃描達上限 ${MAX_PER_RUN} 筆，剩下的留到下一輪`,
      "warning",
    )
  }

  const summary: ExpireSummary = {
    found: rows.length,
    cancelled,
    failed,
    cappedAt: capped ? MAX_PER_RUN : null,
    orderNumbers,
  }
  console.log(
    `[expire-unpaid-orders] 逾期 ${summary.found} 筆，取消 ${summary.cancelled} 筆，失敗 ${summary.failed} 筆（截止時間 ${cutoff}）`,
  )
  return summary
}

export const expireUnpaidOrdersWorker = new Worker(
  "expire-unpaid-orders",
  async (job) => {
    if (job.name !== "expire") return
    return expireUnpaidOrders()
  },
  { connection },
)
