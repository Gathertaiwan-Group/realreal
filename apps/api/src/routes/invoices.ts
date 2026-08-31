import { randomUUID } from "node:crypto"
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

  // Reset the error state AND the retry counter. retry_count is what
  // claim_invoice_issue checks against p_max_retries, so clearing it here is the
  // deliberate human override that un-sticks an invoice which has burned through
  // its automatic retries (3 live rows sit at retry_count=10 today). Without
  // this, the backlog of paid-but-unissued invoices could not be re-driven from
  // the admin UI at all.
  //
  // NOTE: `status` is deliberately NOT reset. A row sitting in 'issuing' is
  // either genuinely in flight (the claim will refuse this job — correct) or
  // stale (the claim takes it over once past the stale window — also correct).
  // Forcing it back to 'pending' here would hand out a second claim on an
  // invoice that may already be at Amego.
  await supabase
    .from("invoices")
    .update({ error_message: null, retry_count: 0 })
    .eq("id", id)

  // A UNIQUE jobId per press, on purpose. BullMQ ignores an `add()` whose jobId
  // already exists — including jobs sitting in the completed/failed sets — so a
  // stable id would silently swallow the second, third, … reissue and leave the
  // admin staring at a success message that did nothing. Re-runnability is
  // safe here because duplicate *issuance* is prevented in the database
  // (claim_invoice_issue), not by queue de-duplication: press it ten times and
  // exactly one job wins the claim, the rest return skipped:"locked".
  // randomUUID, not Date.now(): millisecond resolution is not enough. Two
  // clicks — or a scripted loop re-driving the paid-but-unissued backlog — can
  // land in the same millisecond, collide on jobId, and have the second add()
  // silently discarded while the API still returns 200.
  // Segments are '-'-joined, never ':' — BullMQ rejects a custom jobId that
  // contains ':' (its Redis key separator) with "Custom Id cannot contain :",
  // which throws here (500, nothing enqueued). randomUUID keeps it unique.
  const jobId = `invoice-reissue-${id}-${randomUUID()}`
  await invoiceQueue.add(
    "issue",
    { invoiceId: id },
    { jobId, attempts: 5, backoff: { type: "exponential", delay: 60000 } },
  )

  res.json({ message: "Invoice reissue job enqueued", invoiceId: id, jobId })
})

// ---------------------------------------------------------------------------
// POST /admin/invoices/reissue-batch — re-drive the whole unissued backlog
// ---------------------------------------------------------------------------
// When Amego's 字軌 (invoice number range) runs out, every issue attempt fails
// until a new range is allocated — and then the entire backlog needs re-driving
// by hand, one :id/reissue press per invoice. That happened on 2026-08-20 and
// left 45 invoices stranded for 11 days; pressing the button 45 times is not a
// reasonable recovery procedure, and the range WILL run out again.
//
// This does exactly what :id/reissue does, in a loop, with two guards:
//
//   - Legacy WordPress orders are excluded by default. Those orders were
//     invoiced on the old platform before the 2026-06-29 import; issuing again
//     here would duplicate a real invoice (a tax problem, not just noise).
//     `includeLegacy: true` overrides, for the case where they genuinely were
//     never invoiced.
//   - Jobs are spaced by `delayMs` so a 45-invoice backlog doesn't arrive at
//     Amego as a burst.
//
// Duplicate issuance is prevented in the database by claim_invoice_issue
// (migration 0049), the same guard the single-press path relies on — this
// endpoint adds no new issuance route, it only enqueues more of them.
invoicesRouter.post("/reissue-batch", async (req, res) => {
  const { includeLegacy, limit, delayMs } = req.body as {
    includeLegacy?: boolean
    limit?: number
    delayMs?: number
  }
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 500)
  const spacing = Math.min(Math.max(Number(delayMs) || 1000, 0), 10000)

  const { data: rows, error } = await supabase
    .from("invoices")
    .select("id, order_id, status")
    .neq("status", "issued")
    .neq("status", "voided")
    .limit(cap)
  if (error) { res.status(500).json({ error: error.message }); return }

  const candidates = (rows ?? []) as Array<{ id: string; order_id: string; status: string }>
  if (candidates.length === 0) {
    res.json({ message: "No unissued invoices", enqueued: 0, skippedLegacy: 0, invoiceIds: [] })
    return
  }

  // Resolve order numbers so legacy (WP-prefixed) orders can be held back.
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, order_number")
    .in("id", candidates.map((c) => c.order_id))
  const numberById = new Map(
    ((orderRows ?? []) as Array<{ id: string; order_number: string }>)
      .map((o) => [o.id, o.order_number]),
  )

  const targets: typeof candidates = []
  let skippedLegacy = 0
  for (const c of candidates) {
    const isLegacy = (numberById.get(c.order_id) ?? "").startsWith("WP")
    if (isLegacy && !includeLegacy) { skippedLegacy++; continue }
    targets.push(c)
  }

  const enqueued: string[] = []
  const failed: Array<{ invoiceId: string; error: string }> = []
  for (let i = 0; i < targets.length; i++) {
    const inv = targets[i]
    try {
      // Same reset as the single-press path: clear the error and the retry
      // counter that claim_invoice_issue checks against p_max_retries. `status`
      // is deliberately left alone — see the note on :id/reissue above.
      await supabase
        .from("invoices")
        .update({ error_message: null, retry_count: 0 })
        .eq("id", inv.id)

      await invoiceQueue.add(
        "issue",
        { invoiceId: inv.id },
        {
          jobId: `invoice-reissue-${inv.id}-${randomUUID()}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 60000 },
          delay: i * spacing,
        },
      )
      enqueued.push(inv.id)
    } catch (err) {
      failed.push({ invoiceId: inv.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  res.json({
    message: `Enqueued ${enqueued.length} invoice job(s)`,
    enqueued: enqueued.length,
    skippedLegacy,
    failed,
    invoiceIds: enqueued,
  })
})

// ---------------------------------------------------------------------------
// POST /admin/invoices/reclaim-stale — 把卡在 issuing 的撿回來
// ---------------------------------------------------------------------------
// 'issuing' means "someone is issuing this right now". When a process dies
// mid-flight that statement becomes false, and the row disappears from the
// admin's status=pending filter — invisible to both the backlog query and the
// operator. This restores visibility.
//
// It only moves rows back to 'pending'; it deliberately does NOT re-enqueue
// them. Whether to actually (re-)issue a stuck invoice is an operator decision.
// Retrying a reclaimed row is safe because issue_attempts survives the reclaim,
// so the issuer will query Amego by OrderId before issuing anything.

invoicesRouter.post("/reclaim-stale", async (req, res) => {
  const { staleAfter, limit } = req.body as { staleAfter?: string; limit?: number }

  const { data, error } = await supabase.rpc("reclaim_stale_invoices", {
    p_stale_after: staleAfter ?? "10 minutes",
    p_limit: limit ?? 100,
  })

  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ reclaimed: data ?? [], count: Array.isArray(data) ? data.length : 0 })
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
