import { Router } from "express"
import crypto from "crypto"
import { supabase } from "../../lib/supabase"

export const amegoWebhookRouter = Router()

// ---------------------------------------------------------------------------
// POST /webhooks/amego — Amego e-invoice event webhook
// ---------------------------------------------------------------------------

amegoWebhookRouter.post("/", async (req, res) => {
  // Verify HMAC-SHA256 signature
  const signature = req.headers["x-amego-signature"] as string | undefined
  const secret = process.env.AMEGO_WEBHOOK_SECRET ?? ""

  if (!signature) {
    res.status(401).json({ error: "Missing X-Amego-Signature header" }); return
  }

  const bodyStr = (req as any).rawBody as string | undefined ?? JSON.stringify(req.body)
  const expected = crypto
    .createHmac("sha256", secret)
    .update(bodyStr)
    .digest("hex")

  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    res.status(401).json({ error: "Invalid signature" }); return
  }

  const { event, data } = req.body as { event: string; data: Record<string, any> }

  // Idempotency: use event + amegoId as unique key
  const idempotencyKey = `amego_${event}_${data?.amegoId ?? data?.invoice_id ?? ""}`

  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      gateway: "amego",
      merchant_trade_no: idempotencyKey,
      payload: JSON.stringify(req.body),
    })

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      // Already processed — return 200 to acknowledge
      res.json({ received: true, duplicate: true }); return
    }
    console.error("[webhooks/amego] idempotency insert failed:", idempotencyError)
    res.status(500).json({ error: "Internal server error" }); return
  }

  if (event === "invoice.issued") {
    const { amegoId, invoiceNumber, randomCode } = data as {
      amegoId: string
      invoiceNumber: string
      randomCode: string
    }

    const { error } = await supabase
      .from("invoices")
      .update({
        status: "issued",
        invoice_number: invoiceNumber,
        random_code: randomCode,
        issued_at: new Date().toISOString(),
      })
      .eq("amego_id", amegoId)

    if (error) {
      console.error("[webhooks/amego] invoice.issued update failed:", error)
      res.status(500).json({ error: error.message }); return
    }

  } else if (event === "invoice.voided") {
    const { amegoId } = data as { amegoId: string }

    const { error } = await supabase
      .from("invoices")
      .update({ status: "voided" })
      .eq("amego_id", amegoId)

    if (error) {
      console.error("[webhooks/amego] invoice.voided update failed:", error)
      res.status(500).json({ error: error.message }); return
    }

  } else {
    console.warn("[webhooks/amego] unknown event:", event)
  }

  res.json({ received: true })
})
