import { Router } from "express"
import { supabase } from "../lib/supabase"
import { voidInvoice, invoicePdfUrl } from "../lib/amego"
import { invoiceQueue } from "../lib/queue"

export const invoicesRouter = Router()

// ---------------------------------------------------------------------------
// GET /admin/invoices — list invoices with optional status/date filter
// ---------------------------------------------------------------------------

invoicesRouter.get("/", async (req, res) => {
  const { status, from, to, page = "1", limit = "20" } = req.query as Record<string, string>

  let query = supabase
    .from("invoices")
    .select("*", { count: "exact" })
    .order("issued_at", { ascending: false, nullsFirst: true })
    .range((Number(page) - 1) * Number(limit), Number(page) * Number(limit) - 1)

  if (status) query = query.eq("status", status)
  if (from) query = query.gte("issued_at", from)
  if (to) query = query.lte("issued_at", to)

  const { data, error, count } = await query

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ data: data ?? [], total: count ?? 0, page: Number(page), limit: Number(limit) })
})

// ---------------------------------------------------------------------------
// POST /admin/invoices/:id/reissue — re-enqueue invoice job
// ---------------------------------------------------------------------------

invoicesRouter.post("/:id/reissue", async (req, res) => {
  const { id } = req.params

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, status")
    .eq("id", id)
    .single()

  if (error || !invoice) { res.status(404).json({ error: "Invoice not found" }); return }
  if (invoice.status === "issued") { res.status(400).json({ error: "Invoice already issued" }); return }

  // Reset error state before re-queueing
  await supabase.from("invoices").update({ error_message: null }).eq("id", id)

  await invoiceQueue.add("issue", { invoiceId: id }, { attempts: 5, backoff: { type: "exponential", delay: 60000 } })

  res.json({ message: "Invoice reissue job enqueued", invoiceId: id })
})

// ---------------------------------------------------------------------------
// POST /admin/invoices/:id/void — void invoice via Amego
// ---------------------------------------------------------------------------

invoicesRouter.post("/:id/void", async (req, res) => {
  const { id } = req.params
  const { reason } = req.body as { reason?: string }

  if (!reason) { res.status(400).json({ error: "reason is required" }); return }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, status, amego_id")
    .eq("id", id)
    .single()

  if (error || !invoice) { res.status(404).json({ error: "Invoice not found" }); return }
  if (invoice.status === "voided") { res.status(400).json({ error: "Invoice already voided" }); return }
  if (invoice.status !== "issued") { res.status(400).json({ error: "Only issued invoices can be voided" }); return }
  if (!invoice.amego_id) { res.status(400).json({ error: "Invoice has no amego_id" }); return }

  try {
    await voidInvoice(invoice.amego_id, reason)
  } catch (err: any) {
    res.status(502).json({ error: `Amego void failed: ${err.message}` }); return
  }

  const { data: updated, error: updateError } = await supabase
    .from("invoices")
    .update({
      status: "voided",
      voided_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", id)
    .select()
    .single()

  if (updateError) { res.status(500).json({ error: updateError.message }); return }
  res.json({ data: updated })
})

// ---------------------------------------------------------------------------
// GET /admin/invoices/:id/pdf — redirect to Amego PDF URL
// ---------------------------------------------------------------------------

invoicesRouter.get("/:id/pdf", async (req, res) => {
  const { id } = req.params

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, amego_id, status")
    .eq("id", id)
    .single()

  if (error || !invoice) { res.status(404).json({ error: "Invoice not found" }); return }
  if (!invoice.amego_id) { res.status(400).json({ error: "Invoice PDF not available yet" }); return }

  res.redirect(invoicePdfUrl(invoice.amego_id))
})
