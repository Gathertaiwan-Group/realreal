import { supabase } from "./supabase"
import { renderAndSendEmail } from "../workers/email-sender"
import { incrementSpendAndUpgrade } from "./tier"
import { inventoryQueue } from "./queue"
import { invoiceQueue } from "../workers/invoice-issuer"

/**
 * After a successful payment, send confirmation email, create invoice,
 * and update membership. No BullMQ/Redis needed — all direct calls.
 * Shared across all payment gateway webhooks (PChomePay, LINE Pay, JKOPay).
 */
export async function enqueuePostPaymentJobs(orderId: string) {
  // Fetch order details needed for the email
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, total, guest_email, user_id, order_items(*)")
    .eq("id", orderId)
    .single()

  if (!order) {
    console.warn(`[post-payment] order ${orderId} not found, skipping`)
    return
  }

  // 0) Update total_spend, check tier upgrade, accumulate charity_savings
  if (order.user_id) {
    try {
      await incrementSpendAndUpgrade(order.user_id, Number(order.total))
    } catch (err) {
      console.warn("[post-payment] tier upgrade failed (non-fatal):", err)
    }
  }

  // Resolve recipient: registered user email (from auth.users via admin API)
  // or guest checkout email.
  let userEmail: string | undefined
  if (order.user_id) {
    try {
      const { data } = await supabase.auth.admin.getUserById(order.user_id)
      userEmail = data?.user?.email ?? undefined
    } catch { /* ignore */ }
  }
  const recipientEmail = userEmail ?? (order as any).guest_email as string | undefined

  // 1) Send confirmation email directly (no queue)
  if (recipientEmail) {
    try {
      await renderAndSendEmail({
        template: "payment-confirmed",
        to: recipientEmail,
        data: {
          orderNumber: order.order_number,
          amount: String(order.total),
          method: "",
        },
      })
    } catch (err) {
      console.warn("[post-payment] email send failed (non-fatal):", err)
    }
  } else {
    console.warn(`[post-payment] no email for order ${orderId}, skipping email`)
  }

  // 2) Create an invoice record (if not already present) and enqueue Amego
  //    issuance via the invoice worker.
  try {
    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle()

    if (!existingInvoice) {
      await supabase
        .from("invoices")
        .insert({
          order_id: orderId,
          amount: order.total,
          tax_amount: 0,
          status: "pending",
          type: "b2c",
          carrier_type: "member",
        })
    }

    await invoiceQueue.add(
      "issue",
      { orderId },
      { attempts: 5, backoff: { type: "exponential", delay: 60000 } },
    )
  } catch (err) {
    console.warn("[post-payment] invoice creation/enqueue failed (non-fatal):", err)
  }

  // 3) Enqueue logistics shipment creation (processed by the inventory worker).
  // The worker is idempotent — it re-checks order.status === "paid" and skips
  // if a logistics record already exists.
  try {
    await inventoryQueue.add(
      "create-shipment",
      { orderId },
      { attempts: 5, backoff: { type: "exponential", delay: 60000 } },
    )
  } catch (err) {
    console.warn("[post-payment] logistics enqueue failed (non-fatal):", err)
  }
}
