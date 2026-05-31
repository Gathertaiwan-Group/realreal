import { supabase } from "./supabase"
import { renderAndSendEmail } from "../workers/email-sender"
import { sendEmail } from "./email"
import { incrementSpendAndUpgrade, incrementPeriodSpend } from "./tier"
import { inventoryQueue } from "./queue"
import { invoiceQueue } from "../workers/invoice-issuer"
import { getSetting } from "./settings"
import { grantPoints, redeemPoints } from "./points"
import { sendLineNotify } from "./line-notify"

/**
 * After a successful payment, send confirmation email, create invoice,
 * and update membership. No BullMQ/Redis needed — all direct calls.
 * Shared across all payment gateway webhooks (PChomePay, LINE Pay, JKOPay).
 */
export async function enqueuePostPaymentJobs(orderId: string) {
  // Fetch order details needed for the email
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, total, guest_email, user_id, points_used, attributed_kol_slug, order_items(*)")
    .eq("id", orderId)
    .single()

  if (!order) {
    console.warn(`[post-payment] order ${orderId} not found, skipping`)
    return
  }

  // orders.total is stored in cents (e.g. 10000 = NT$100). Convert once here
  // so every downstream consumer gets TWD without per-call division.
  const totalTwd = Math.round(Number(order.total) / 100)

  // 0) Update total_spend, check tier upgrade, accumulate charity_savings
  if (order.user_id) {
    try {
      await incrementSpendAndUpgrade(order.user_id, totalTwd)
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

  // 1a) Customer confirmation email
  if (recipientEmail) {
    try {
      await renderAndSendEmail({
        template: "payment-confirmed",
        to: recipientEmail,
        data: {
          orderNumber: order.order_number,
          amount: String(totalTwd),
          method: "",
        },
      })
    } catch (err) {
      console.warn("[post-payment] customer email send failed (non-fatal):", err)
    }
  } else {
    console.warn(`[post-payment] no email for order ${orderId}, skipping customer email`)
  }

  // 1b) Admin "new order" notification — configurable address.
  try {
    const adminEmail = await getSetting("notifications.admin_email")
    if (adminEmail) {
      // Pull shipping address + items for a richer admin email.
      const [{ data: shippingRow }, { data: items }] = await Promise.all([
        supabase
          .from("order_addresses")
          .select("name, phone, address_type, address, cvs_store_id, cvs_type, city, postal_code")
          .eq("order_id", orderId)
          .eq("type", "shipping")
          .maybeSingle(),
        supabase
          .from("order_items")
          .select("product_snapshot, qty, unit_price")
          .eq("order_id", orderId),
      ])

      const itemLines = (items ?? [])
        .map((it: any) => {
          const snap = it.product_snapshot ?? {}
          const name = snap.name ?? "商品"
          const variant = snap.variant_name && snap.variant_name !== "預設"
            ? `（${snap.variant_name}）`
            : ""
          return `  • ${name}${variant} × ${it.qty} = NT$ ${Number(it.unit_price) * Number(it.qty)}`
        })
        .join("\n")

      let shippingLine = "—"
      if (shippingRow) {
        const s: any = shippingRow
        if (s.address_type === "cvs") {
          const chain = s.cvs_type === "family" ? "全家" : "7-11"
          shippingLine = `${chain} ${s.address ?? ""} (${s.cvs_store_id ?? ""})`
        } else {
          shippingLine = `宅配 ${s.postal_code ?? ""} ${s.city ?? ""} ${s.address ?? ""}`.trim()
        }
      }

      const subject = `【誠真生活】新訂單 ${order.order_number} — NT$ ${totalTwd}`
      const html = `
        <div style="font-family: -apple-system, sans-serif; max-width:600px;">
          <h2 style="color:#10305a;margin:0 0 8px">新訂單通知</h2>
          <p style="color:#687279;margin:0 0 24px">付款已完成，請準備出貨。</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <tr><td style="padding:6px 0;color:#687279;width:120px">訂單編號</td><td style="font-family:monospace;font-weight:600">${order.order_number}</td></tr>
            <tr><td style="padding:6px 0;color:#687279">總金額</td><td style="font-weight:600;color:#10305a">NT$ ${totalTwd}</td></tr>
            <tr><td style="padding:6px 0;color:#687279">收件人</td><td>${(shippingRow as any)?.name ?? "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#687279">電話</td><td><a href="tel:${(shippingRow as any)?.phone ?? ""}">${(shippingRow as any)?.phone ?? "—"}</a></td></tr>
            <tr><td style="padding:6px 0;color:#687279;vertical-align:top">取貨</td><td>${shippingLine}</td></tr>
            <tr><td style="padding:6px 0;color:#687279;vertical-align:top">商品</td><td style="white-space:pre-line">${itemLines || "—"}</td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:13px;color:#687279">進管理後台處理 → <a href="https://realreal-store.vercel.app/admin/orders" style="color:#10305a">/admin/orders</a></p>
        </div>
      `
      await sendEmail({ to: adminEmail, subject, html })
    }
  } catch (err) {
    console.warn("[post-payment] admin notification failed (non-fatal):", err)
  }

  // 1c) LINE Notify push — spec M Section 2. Goes to whoever holds the
  // configured access token (typically the admin's personal LINE via 1-on-1
  // Notify). Fire-and-forget semantics live inside sendLineNotify itself.
  const kolSlug = (order as { attributed_kol_slug?: string | null })
    .attributed_kol_slug ?? null
  await sendLineNotify(
    `🛒 新訂單 #${order.order_number}\n` +
      `顧客：${userEmail ?? "guest"}\n` +
      `金額：NT$ ${totalTwd}` +
      (kolSlug ? `\n來自 KOL：${kolSlug}` : ""),
  )

  // 2) Create an invoice record (if not already present) and enqueue Amego
  //    issuance via the invoice worker.
  try {
    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle()

    if (!existingInvoice) {
      // Schema enum (0001_initial.sql + 0003_invoice_extensions.sql):
      //   type        ∈ B2C_2 / B2C_3 / B2B
      //   carrier_type∈ phone / natural_person / love_code (or NULL)
      // The previous "b2c" + "member" violated both check constraints, the
      // insert silently 23514'd, and the worker logged "No pending invoice
      // found" forever. B2C_2 = 雲端發票二聯式, no carrier = "會員載具" by
      // default at Amego (handled in amego.ts when carrier_type is null).
      const { error: invErr } = await supabase
        .from("invoices")
        .insert({
          order_id: orderId,
          amount: totalTwd,
          tax_amount: 0,
          status: "pending",
          type: "B2C_2",
          carrier_type: null,
        })
      if (invErr) {
        console.warn("[post-payment] invoice insert failed:", invErr.message)
      }
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

  // 4) Points lifecycle — direct DB writes (no BullMQ). Must be transactional
  // with the post-payment flow but should not block the other steps on error.
  // tier_id is read *after* incrementSpendAndUpgrade so we credit the upgraded
  // tier's rebate_rate when this order is the one that bumps them up.
  if (order.user_id) {
    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("membership_tier_id")
        .eq("user_id", order.user_id)
        .single()
      const tierId = (profile as { membership_tier_id?: string | null } | null)
        ?.membership_tier_id ?? null

      // Grant earned points based on tier rebate_rate
      await grantPoints(orderId, order.user_id, totalTwd, tierId)

      // Redeem points if order.points_used > 0
      const pointsUsed = Number((order as { points_used?: number }).points_used ?? 0)
      if (pointsUsed > 0) {
        await redeemPoints(orderId, order.user_id, pointsUsed)
      }
    } catch (err) {
      console.warn("[post-payment] points grant/redeem failed (non-fatal):", err)
    }

    // 5) Accumulate tier_period_spend for requalification window tracking.
    // Independent try/catch so a failure here does not block any other step.
    try {
      await incrementPeriodSpend(order.user_id, totalTwd)
    } catch (err) {
      console.warn("[post-payment] incrementPeriodSpend failed (non-fatal):", err)
    }
  }
}
