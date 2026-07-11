import { supabase } from "../lib/supabase"
import { renderAndSendEmail } from "../workers/email-sender"
import { makeRepayToken } from "../lib/repay-token"
import { getApiBaseUrl } from "../lib/urls"

/**
 * Unpaid-order reminder — enqueued as a delayed job (6h) when an online-payment
 * order is created (orders.ts). By the time it fires the customer may have paid,
 * cancelled, or still be sitting unpaid. We only email in that last case.
 *
 * Exactly one delayed job is enqueued per order, so "只寄一次" is guaranteed by
 * construction — no dedupe column needed. COD orders never enqueue this (they
 * have nothing to pay online).
 */
const ONLINE_METHODS = new Set(["linepay", "jkopay", "pchomepay"])

export async function processPaymentReminder(orderId: string): Promise<void> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, status, payment_status, payment_method, guest_email, user_id, total, deleted_at")
    .eq("id", orderId)
    .single()

  if (!order) {
    console.warn(`[payment-reminder] order ${orderId} not found, skipping`)
    return
  }

  // Only remind orders that are STILL unpaid online orders. Anything that moved
  // on (paid / cancelled / failed / archived / COD) needs no reminder.
  if (order.deleted_at) return
  if (!ONLINE_METHODS.has(order.payment_method as string)) return
  if (order.payment_status === "paid") return
  if (order.status !== "pending") return

  const [{ data: shippingRow }, { data: orderItemRows }] = await Promise.all([
    supabase
      .from("order_addresses")
      .select("name, address_type, address, cvs_store_id, cvs_type, city, postal_code")
      .eq("order_id", orderId)
      .eq("type", "shipping")
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("product_snapshot, qty, unit_price")
      .eq("order_id", orderId),
  ])

  const s: any = shippingRow ?? {}
  const customerName: string = s.name ?? "顧客"

  const mappedItems = (orderItemRows ?? []).map((it: any) => {
    const snap = it.product_snapshot ?? {}
    const name = snap.name ?? "商品"
    const variant = snap.variant_name && snap.variant_name !== "預設" ? `（${snap.variant_name}）` : ""
    return {
      name: `${name}${variant}`,
      qty: Number(it.qty),
      price: String(Number(it.unit_price) * Number(it.qty)),
    }
  })

  let pickupInfo = "—"
  if (shippingRow) {
    if (s.address_type === "cvs") {
      const chain = s.cvs_type === "family" ? "全家" : "7-11"
      pickupInfo = `${chain} ${s.address ?? ""} (${s.cvs_store_id ?? ""})`.trim()
    } else {
      pickupInfo = `宅配｜${s.postal_code ?? ""} ${s.city ?? ""} ${s.address ?? ""}`.trim()
    }
  }

  // Resolve the customer's email: registered user via auth, else guest_email.
  let recipientEmail: string | undefined
  if (order.user_id) {
    try {
      const { data } = await supabase.auth.admin.getUserById(order.user_id as string)
      recipientEmail = data?.user?.email ?? undefined
    } catch { /* ignore */ }
  }
  if (!recipientEmail) recipientEmail = (order.guest_email as string | null | undefined) ?? undefined

  if (!recipientEmail) {
    console.warn(`[payment-reminder] no email for order ${orderId}, skipping`)
    return
  }

  const orderNumber = order.order_number as string
  const token = makeRepayToken(orderNumber)
  const repayUrl = `${getApiBaseUrl()}/orders/${encodeURIComponent(orderNumber)}/repay?token=${token}`

  try {
    await renderAndSendEmail({
      template: "payment-reminder",
      to: recipientEmail,
      data: {
        orderNumber,
        customerName,
        amount: String(Math.round(Number(order.total ?? 0))),
        items: mappedItems,
        pickupInfo,
        repayUrl,
      },
    })
    console.log(`[payment-reminder] sent for order ${orderNumber} → ${recipientEmail}`)
  } catch (err) {
    console.warn(`[payment-reminder] send failed for order ${orderId} (non-fatal):`, err)
  }
}
