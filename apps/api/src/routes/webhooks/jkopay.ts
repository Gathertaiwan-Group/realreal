import { Router } from "express"
import { supabase } from "../../lib/supabase"
import { verifySignature, getJkopaySecretKey } from "../../lib/jkopay"

export const jkopayWebhookRouter = Router()

async function restoreStockForOrder(orderId: string) {
  const { data: items, error } = await supabase
    .from("order_items")
    .select("variant_id, qty")
    .eq("order_id", orderId)

  if (error) throw new Error(error.message)

  const variants = (items ?? [])
    .filter((item: any) => item.variant_id && Number(item.qty) > 0)
    .map((item: any) => ({ id: item.variant_id, qty: Number(item.qty) }))

  if (variants.length === 0) return

  const restored = await supabase.rpc("atomic_restore_stock", { p_variants: variants })
  if (restored.error) throw new Error(restored.error.message)
}

// POST /webhooks/jkopay — JKOPay server notification via X-Signature header
jkopayWebhookRouter.post("/", async (req, res) => {
  // HMAC must be verified against the EXACT bytes JKOPay signed — re-encoding
  // via JSON.stringify(req.body) re-orders keys and rewrites Unicode escapes.
  const rawBody = (req as any).rawBody as string | undefined ?? JSON.stringify(req.body)
  const signature = req.headers["x-signature"] as string

  const secretKey = await getJkopaySecretKey()
  if (!signature || !verifySignature(rawBody, signature, secretKey)) {
    res.status(400).json({ error: "Invalid signature" }); return
  }

  const { merchant_trade_no, trade_no, status } = req.body as Record<string, string>

  if (!merchant_trade_no) {
    res.status(400).json({ error: "Missing merchant_trade_no" }); return
  }

  // Idempotency guard — insert into webhook_events, catch unique constraint "23505"
  const { error: idempotencyError } = await supabase
    .from("webhook_events")
    .insert({
      gateway: "jkopay",
      merchant_trade_no: merchant_trade_no,
      payload: rawBody,
    })

  if (idempotencyError) {
    if (idempotencyError.code === "23505") {
      res.json({ result: "OK" }); return
    }
    console.error("[webhooks/jkopay] idempotency insert failed:", idempotencyError)
    res.status(500).json({ error: "InternalError" }); return
  }

  const success = status === "SUCCESS"

  const { data: tx } = await supabase
    .from("payments")
    .select("id, order_id")
    .eq("gateway_tx_id", merchant_trade_no)
    .maybeSingle()

  if (tx) {
    if (!success) {
      const { data: order } = await supabase
        .from("orders")
        .select("payment_status")
        .eq("id", tx.order_id)
        .maybeSingle()
      if (order?.payment_status !== "paid") {
        try {
          await restoreStockForOrder(tx.order_id)
        } catch (err) {
          console.warn("[webhooks/jkopay] restore stock failed (non-fatal):", err)
        }
      }
    }

    await supabase
      .from("payments")
      .update({
        status: success ? "captured" : "failed",
        raw_response: JSON.stringify({ ...req.body, gateway_trade_no: trade_no }),
      })
      .eq("id", tx.id)

    const { error: flipErr } = await supabase
      .from("orders")
      .update({
        status: success ? "processing" : "failed",
        payment_status: success ? "paid" : "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", tx.order_id)
    if (flipErr) {
      // Rewind dedupe + 500 so JKOPay retries; otherwise a paid order is
      // silently stuck on pending.
      console.error("[webhooks/jkopay] order status flip failed:", flipErr)
      await supabase.from("webhook_events").delete()
        .eq("gateway", "jkopay").eq("merchant_trade_no", merchant_trade_no)
      res.status(500).json({ error: "order update failed" }); return
    }

    if (success) {
      try {
        const { enqueuePostPaymentJobs } = await import("../../lib/enqueue-post-payment")
        await enqueuePostPaymentJobs(tx.order_id)
      } catch (err) {
        console.warn("[webhooks/jkopay] enqueue jobs failed (non-fatal):", err)
      }
    }
  }

  res.json({ result: "OK" })
})
