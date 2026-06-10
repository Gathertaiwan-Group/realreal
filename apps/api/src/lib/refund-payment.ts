import { supabase } from "./supabase"
import { sendEmail } from "./email"
import { getSettingOrEnv } from "./settings"

/**
 * Refund an order's payment.
 *
 * Spec: docs/superpowers/specs/2026-05-30-order-state-transitions-and-cancellation.md
 * (Section 3 — `lib/refund-payment.ts`)
 *
 * V1 behaviour:
 *  1. Mark the row in `payments` for this order as `refund_requested`
 *     (only flips rows currently in `succeeded` — we don't touch failed /
 *     pending payments).
 *  2. Send a notification e-mail to the admin address configured in
 *     `notifications.admin_email` (falls back to `ADMIN_EMAIL` env var)
 *     so a human knows to issue the actual refund in the gateway's portal.
 *
 * V1 deliberately does NOT call the gateway's refund API. The cancel
 * endpoint must keep moving even if the refund step is just a "todo" —
 * admins will hit the gateway dashboard manually. The TODO block below
 * is the hook for the future per-provider switch.
 */
export async function refundPayment(
  order: {
    id: string
    payment_method?: string | null
    total?: number | string | null
    gateway_tx_id?: string | null
  },
  reason: string,
): Promise<{ ok: boolean; message: string }> {
  // 1) Mark payments as refund_requested so admin lists / reports reflect
  //    the pending refund. Only flips rows currently in `succeeded`.
  const { error: paymentsError } = await supabase
    .from("payments")
    .update({ status: "refund_requested" })
    .eq("order_id", order.id)
    .eq("status", "succeeded")

  if (paymentsError) {
    return {
      ok: false,
      message: `更新付款記錄失敗：${paymentsError.message}`,
    }
  }

  // 2) Notify admin so the actual refund happens in the gateway dashboard.
  //    Non-fatal — if the email blows up we still return ok=true because
  //    the DB flag is set; admin will see it in the orders list.
  try {
    const adminEmail = await getSettingOrEnv(
      "notifications.admin_email",
      "ADMIN_EMAIL",
    )
    if (adminEmail) {
      const subject = `[退款待處理] 訂單 ${order.id} 已取消`
      const html = `
        <div style="font-family: -apple-system, sans-serif; max-width:600px;">
          <h2 style="color:#10305a;margin:0 0 8px">退款待處理</h2>
          <p style="color:#687279;margin:0 0 24px">訂單已取消，請至對應金流後台手動退款。</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr><td style="padding:6px 0;color:#687279;width:120px">訂單編號</td><td style="font-family:monospace;font-weight:600">${order.id}</td></tr>
            <tr><td style="padding:6px 0;color:#687279">金流</td><td>${order.payment_method ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#687279">金額</td><td style="font-weight:600;color:#10305a">NT$ ${order.total != null ? Number(order.total) : "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#687279;vertical-align:top">取消原因</td><td style="white-space:pre-line">${reason}</td></tr>
          </table>
        </div>
      `
      await sendEmail({ to: adminEmail, subject, html })
    } else {
      console.warn(
        `[refund-payment] no admin email configured, skipping notification for order ${order.id}`,
      )
    }
  } catch (err) {
    console.warn(
      `[refund-payment] admin notification failed (non-fatal) for order ${order.id}:`,
      err,
    )
  }

  return {
    ok: true,
    message: "已標記退款請求，請至金流後台手動操作",
  }

  // TODO future: per-provider real refund API.
  // switch (order.payment_method) {
  //   case "pchomepay": return refundPchome(order.gateway_tx_id, order.total)
  //   case "linepay":   return refundLinepay(order.gateway_tx_id, order.total)
  //   case "jkopay":    return refundJkopay(order.gateway_tx_id, order.total)
  // }
}
