import { supabase } from "./supabase"
import { renderAndSendEmail } from "../workers/email-sender"
import { sendEmail, parseRecipients } from "./email"
import { incrementSpendAndUpgrade } from "./tier"
import { inventoryQueue } from "./queue"
import { invoiceQueue } from "../workers/invoice-issuer"
import { getSetting } from "./settings"
import { grantPoints, loadPointsSettings, redeemPoints } from "./points"
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
    .select("id, order_number, subtotal, discount_amount, total, guest_email, user_id, points_used, attributed_kol_slug, metadata, order_items(*)")
    .eq("id", orderId)
    .single()

  if (!order) {
    console.warn(`[post-payment] order ${orderId} not found, skipping`)
    return
  }

  const totalTwd = Number(order.total ?? 0)

  // 0) Update total_spend, check tier upgrade, accumulate charity_savings.
  // Idempotency: stamp order_post_payment_log.tier_incremented_at so webhook
  // retries / admin POST /retry-post-payment can't double-count.
  //
  // B6: the claim used to be stamped BEFORE incrementSpendAndUpgrade ran, so a
  // transient RPC failure left the step claimed → the retry saw it claimed,
  // skipped, and the spend was never counted. `claim_order_post_payment_step`
  // has no unclaim (migration 0034), so we use claim-AFTER-success instead:
  //   1. read the sentinel as an early-out for an already-completed run
  //      (sequential webhook retry / admin retry-post-payment),
  //   2. run incrementSpendAndUpgrade,
  //   3. claim the step only AFTER it succeeds.
  // A failure now leaves the step UNclaimed so the next retry re-runs it.
  if (order.user_id) {
    try {
      const { data: priorLog } = await supabase
        .from("order_post_payment_log")
        .select("tier_incremented_at")
        .eq("order_id", orderId)
        .maybeSingle()
      const alreadyIncremented = Boolean(
        (priorLog as { tier_incremented_at?: string | null } | null)
          ?.tier_incremented_at,
      )
      if (!alreadyIncremented) {
        // Do the work first. If this throws, no sentinel is stamped → retry-safe.
        await incrementSpendAndUpgrade(order.user_id, totalTwd)
        // Stamp the sentinel only now that the increment actually applied. The
        // test-and-set (WHERE tier_incremented_at IS NULL) keeps a duplicate
        // webhook that slipped past the read above from re-counting.
        const { error: claimError } = await supabase.rpc(
          "claim_order_post_payment_step",
          { p_order_id: orderId, p_step: "tier_incremented" },
        )
        if (claimError) {
          // Increment already applied; we just couldn't stamp the sentinel.
          // Surface it (don't claim phantom success) — a retry is gated by the
          // read above once the row's timestamp lands, and incrementSpend's own
          // FOR UPDATE makes a worst-case re-run observable rather than silent.
          console.warn(
            `[post-payment] tier increment applied but claim failed for order=${orderId}:`,
            claimError,
          )
        }
      }
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
    const adminEmails = parseRecipients(await getSetting("notifications.admin_email"))
    if (adminEmails.length > 0) {
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
      await sendEmail({ to: adminEmails, subject, html })
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
      // Use the buyer's chosen invoice (persisted on order.metadata.invoice by
      // POST /orders) so B2B 統編 / 手機載具 / 愛心碼 issue correctly. Falls back
      // to B2C_2 (雲端發票二聯式, 會員載具 at Amego) when none was provided.
      const inv = (order as { metadata?: { invoice?: {
        type?: "B2C_2" | "B2C_3" | "B2B"
        carrierType?: "phone" | "natural_person" | "love_code"
        carrierNumber?: string
        loveCode?: string
        taxId?: string
        companyTitle?: string
      } } | null }).metadata?.invoice
      const invType = inv?.type ?? "B2C_2"
      const { error: invErr } = await supabase
        .from("invoices")
        .insert({
          order_id: orderId,
          amount: totalTwd,
          tax_amount: 0,
          status: "pending",
          type: invType,
          carrier_type: invType === "B2C_3" ? (inv?.carrierType ?? null) : null,
          carrier_number: invType === "B2C_3" && inv?.carrierType !== "love_code" ? (inv?.carrierNumber ?? null) : null,
          love_code: invType === "B2C_3" && inv?.carrierType === "love_code" ? (inv?.loveCode ?? inv?.carrierNumber ?? null) : null,
          tax_id: invType === "B2B" ? (inv?.taxId ?? null) : null,
          company_title: invType === "B2B" ? (inv?.companyTitle ?? null) : null,
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

      // Redeem points if order.points_used > 0
      const pointsUsed = Number((order as { points_used?: number }).points_used ?? 0)
      let pointsDiscount = pointsUsed
      try {
        const settings = await loadPointsSettings()
        pointsDiscount = pointsUsed * Number(settings.ratio ?? 1)
      } catch {
        pointsDiscount = pointsUsed
      }
      const subtotalTwd = Number((order as { subtotal?: number | string | null }).subtotal ?? 0)
      const discountTwd = Number((order as { discount_amount?: number | string | null }).discount_amount ?? 0)
      const nonPointsDiscountTwd = Math.max(0, discountTwd - pointsDiscount)
      const earnBaseTwd = Math.max(0, subtotalTwd - nonPointsDiscountTwd)

      // Grant earned points from merchandise after non-points discounts.
      // Shipping and point redemption do not reduce the earn base.
      await grantPoints(orderId, order.user_id, earnBaseTwd, tierId)

      if (pointsUsed > 0) {
        // B6: redeemPoints now returns a status instead of swallowing the
        // insert error. A real failure means the user's points were NOT burned
        // for an order they already paid with them — log it loudly (the points
        // lifecycle is non-fatal to the rest of post-payment, but we must not
        // pretend the burn succeeded). The expire/refund chains and the
        // SELECT-first guard keep a later retry idempotent.
        const redeemResult = await redeemPoints(orderId, order.user_id, pointsUsed)
        if (!redeemResult.ok) {
          console.error(
            `[post-payment] redeemPoints did NOT burn ${pointsUsed} pts for order=${orderId}: ${redeemResult.error}`,
          )
        }
      }
    } catch (err) {
      console.warn("[post-payment] points grant/redeem failed (non-fatal):", err)
    }
  }
}
