/**
 * 出貨滿 20 天自動結案 —— 每天掃一次，安靜地做，不寄任何信。
 *
 * 為什麼需要：訂單出貨後就一直停在「已出貨」，沒有任何東西會把它推到「已完成」。
 * 綠界物流的送達回報會自動結案（webhooks/ecpay-logistics.ts），但郵局宅配、
 * 港澳順豐、以及綠界建單失敗的那些都沒有回報，於是永遠掛在已出貨。
 *
 * 「不寄信」不需要特別處理 —— 系統根本沒有「訂單完成」的信件範本，這裡也只是
 * 一個 UPDATE，不會經過任何寄信的程式。
 *
 * 出貨時間從哪來：orders 沒有 shipped_at 欄位，所以出貨時把時間寫進既有的
 * metadata jsonb（admin-orders.ts 的 shipOrderById）。舊訂單沒有那個欄位，
 * 退回用 updated_at —— 那是「最後一次改動」，只會比真正的出貨日晚，所以最壞
 * 情況是晚幾天結案，不會提早。
 */
import { Worker, Queue } from "bullmq"
import { Redis } from "ioredis"
import * as Sentry from "@sentry/node"
import { supabase } from "../lib/supabase"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
})

export const completeShippedQueue = new Queue("complete-shipped-orders", { connection })

/** 出貨後多久自動結案。改這個值就改政策。 */
export const AUTO_COMPLETE_DAYS = Number(process.env.AUTO_COMPLETE_SHIPPED_DAYS ?? 20)

/** 單次上限 —— 防呆，不是效能考量。第一次跑會有一批舊訂單，之後每天寥寥幾筆。 */
const MAX_PER_RUN = 200

type ShippedRow = {
  id: string
  order_number: string
  updated_at: string
  metadata: Record<string, unknown> | null
}

/** 出貨時間：優先用 metadata.shipped_at，舊訂單退回 updated_at。 */
export function shippedAtOf(row: Pick<ShippedRow, "updated_at" | "metadata">): Date {
  const raw = row.metadata?.["shipped_at"]
  if (typeof raw === "string") {
    const d = new Date(raw)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date(row.updated_at)
}

export function isDue(row: Pick<ShippedRow, "updated_at" | "metadata">, now: Date, days = AUTO_COMPLETE_DAYS): boolean {
  return now.getTime() - shippedAtOf(row).getTime() >= days * 24 * 60 * 60 * 1000
}

export type CompleteSummary = {
  checked: number
  completed: number
  failed: number
  orderNumbers: string[]
}

export async function completeShippedOrders(now = new Date()): Promise<CompleteSummary> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, updated_at, metadata")
    .eq("status", "shipped")
    .order("updated_at", { ascending: true })
    .limit(1000)

  if (error) throw new Error(`complete-shipped-orders query failed: ${error.message}`)

  const rows = (data ?? []) as ShippedRow[]
  const due = rows.filter((r) => isDue(r, now)).slice(0, MAX_PER_RUN)

  let completed = 0
  let failed = 0
  const orderNumbers: string[] = []

  for (const row of due) {
    const nowIso = now.toISOString()
    const { error: updErr } = await supabase
      .from("orders")
      .update({ status: "completed", completed_at: nowIso, updated_at: nowIso })
      .eq("id", row.id)
      // 只有仍是「已出貨」才動它 —— 中途被人改成取消／退款時不要蓋回去。
      .eq("status", "shipped")
    if (updErr) {
      failed++
      console.error(`[complete-shipped-orders] ${row.order_number} 更新失敗：`, updErr.message)
      Sentry.captureException(new Error(updErr.message), {
        tags: { component: "complete-shipped-orders" },
        extra: { orderNumber: row.order_number },
      })
      continue
    }
    completed++
    orderNumbers.push(row.order_number)
  }

  const summary: CompleteSummary = { checked: rows.length, completed, failed, orderNumbers }
  console.log(
    `[complete-shipped-orders] 已出貨 ${summary.checked} 筆，其中滿 ${AUTO_COMPLETE_DAYS} 天的結案 ${summary.completed} 筆，失敗 ${summary.failed} 筆`,
  )
  return summary
}

export const completeShippedWorker = new Worker(
  "complete-shipped-orders",
  async (job) => {
    if (job.name !== "complete") return
    return completeShippedOrders()
  },
  { connection },
)
