import { Worker, Queue } from "bullmq"
import { Redis } from "ioredis"
import { supabase } from "../lib/supabase"
import { issueInvoice, type IssueInvoiceParams } from "../lib/amego"

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null })

export const invoiceQueue = new Queue("invoice", { connection })

export const invoiceWorker = new Worker("invoice", async (job) => {
  // Support both invoiceId (reissue) and orderId (new from payment webhook)
  let invoiceId: string | undefined = job.data.invoiceId

  if (!invoiceId && job.data.orderId) {
    // Look up the invoice by orderId — the webhook handler creates the record before enqueuing
    const { data: inv } = await supabase
      .from("invoices")
      .select("id")
      .eq("order_id", job.data.orderId)
      .neq("status", "issued")
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (!inv) throw new Error(`No pending invoice found for order ${job.data.orderId}`)
    invoiceId = inv.id
  }

  if (!invoiceId) throw new Error("Job data must include invoiceId or orderId")

  const { data: invoice } = await supabase
    .from("invoices")
    .select("*, orders(order_number, total, user_id, order_items(qty, unit_price, product_snapshot))")
    .eq("id", invoiceId)
    .single()

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`)
  if (invoice.status === "issued") return { skipped: true }

  const order = invoice.orders as any

  // Build line items from the order (name lives in product_snapshot JSON)
  const items: IssueInvoiceParams["items"] = Array.isArray(order?.order_items)
    ? order.order_items.map((item: any) => ({
        name: (item.product_snapshot?.name as string) ?? "商品",
        qty: Number(item.qty),
        unitPrice: Number(item.unit_price),
      }))
    : []

  try {
    const result = await issueInvoice({
      orderId: invoice.order_id,
      orderNumber: order?.order_number,
      amount: Number(invoice.amount),
      taxAmount: Number(invoice.tax_amount),
      type: invoice.type as any,
      carrierType: invoice.carrier_type as any,
      carrierNumber: invoice.carrier_number ?? undefined,
      loveCode: invoice.love_code ?? undefined,
      taxId: invoice.tax_id ?? undefined,
      companyTitle: invoice.company_title ?? undefined,
      items,
    })

    await supabase.from("invoices").update({
      status: "issued",
      invoice_number: result.invoiceNumber,
      random_code: result.randomCode,
      amego_id: result.amegoId,
      issued_at: new Date().toISOString(),
    }).eq("id", invoiceId)

  } catch (err: any) {
    await supabase.from("invoices").update({
      error_message: err.message,
      retry_count: (invoice.retry_count ?? 0) + 1,
    }).eq("id", invoiceId)
    throw err
  }
}, { connection })
