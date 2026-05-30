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
    // Look up the invoice by orderId — the post-payment hook creates the
    // record before enqueuing. invoices has no `created_at`, so we just
    // pick any non-issued row for this order (in practice there's only one).
    const { data: inv } = await supabase
      .from("invoices")
      .select("id")
      .eq("order_id", job.data.orderId)
      .neq("status", "issued")
      .limit(1)
      .maybeSingle()

    if (!inv) throw new Error(`No pending invoice found for order ${job.data.orderId}`)
    invoiceId = inv.id
  }

  if (!invoiceId) throw new Error("Job data must include invoiceId or orderId")

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
      // Clear any error from earlier failed attempts so a successful retry
      // doesn't leave a stale timeout/error message behind on the row.
      error_message: null,
      retry_count: 0,
    }).eq("id", invoiceId)

  } catch (err: any) {
    await supabase.from("invoices").update({
      error_message: err.message,
      retry_count: (invoice.retry_count ?? 0) + 1,
    }).eq("id", invoiceId)
    throw err
  }
}, { connection })
