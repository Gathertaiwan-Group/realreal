import { supabase } from "./supabase"
import { renderAndSendEmail } from "../workers/email-sender"
import { sendEmail, parseRecipients } from "./email"
import { incrementSpendAndUpgrade } from "./tier"
import { inventoryQueue, invoiceQueue } from "./queue"
import { getSetting } from "./settings"
import { grantPoints, redeemPoints } from "./points"

/** Escape customer-supplied values before interpolating them into admin email HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * After a successful payment, send confirmation email, create invoice,
 * and update membership. No BullMQ/Redis needed — all direct calls.
 * Shared across all payment gateway webhooks (PChomePay, LINE Pay, JKOPay).
 *
 * For CVS COD orders, the customer/admin/LINE notifications are sent earlier
 * by `notifyOrderPlacedCod()` at checkout time (admin needs to ship BEFORE
 * customer can pay at pickup). When this function runs at COD pickup
 * (ecpay-logistics webhook → delivered → enqueuePostPaymentJobs), it skips
 * the notification block so we don't re-send those emails — invoice / points
 * / tier upgrade still fire because those are the actual payment-time events.
 */
export async function enqueuePostPaymentJobs(orderId: string) {
  // Fetch order details needed for the email
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, subtotal, discount_amount, total, guest_email, user_id, points_used, attributed_kol_slug, metadata, payment_method, notes, order_items(*)")
    .eq("id", orderId)
    .single()

  if (!order) {
    console.warn(`[post-payment] order ${orderId} not found, skipping`)
    return
  }

  const totalTwd = Number(order.total ?? 0)
  const isCod = (order as { payment_method?: string | null }).payment_method === "cvs_cod"

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

  // 1a + 1b) Customer confirmation + admin notification — skipped for COD
  // (notifyOrderPlacedCod already handled both at checkout time).
  if (!isCod) {
    // Fetch shipping address + items once; share between customer and admin emails.
    const [{ data: shippingRow }, { data: orderItemRows }] = await Promise.all([
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

    const itemLines = mappedItems.map(it => `  • ${it.name} × ${it.qty} = NT$ ${it.price}`).join("\n")

    let pickupInfo = "—"
    if (shippingRow) {
      if (s.address_type === "cvs") {
        const chain = s.cvs_type === "family" ? "全家" : "7-11"
        pickupInfo = `${chain} ${s.address ?? ""} (${s.cvs_store_id ?? ""})`.trim()
      } else if (s.address_type === "overseas") {
        pickupInfo = `海外寄送｜${s.city ?? ""} ${s.address ?? ""}`.trim()
      } else {
        pickupInfo = `宅配｜${s.postal_code ?? ""} ${s.city ?? ""} ${s.address ?? ""}`.trim()
      }
    }

    // overseas_cod: shipping fee is collected by the courier on delivery, not
    // charged online — restate the checkout page's amber-box notice here so
    // the customer has a written record, not just a one-time UI moment.
    const codNotice = s.address_type === "overseas"
      ? "採順豐速運寄送，運費由司機收取，收到貨品時當場付款。商品金額已於線上完成付款，無需重複支付。"
      : undefined

    // 1a) Customer email
    if (recipientEmail) {
      try {
        await renderAndSendEmail({
          template: "payment-confirmed",
          to: recipientEmail,
          data: {
            orderNumber: order.order_number,
            amount: String(totalTwd),
            customerName,
            items: mappedItems,
            pickupInfo,
            codNotice,
          },
        })
      } catch (err) {
        console.warn("[post-payment] customer email send failed (non-fatal):", err)
      }
    } else {
      console.warn(`[post-payment] no email for order ${orderId}, skipping customer email`)
    }

    // 1b) Admin notification
    //
    // This is the ONLY admin-facing notification for a new order. It used to be
    // followed by a second LINE Notify push carrying 顧客 email + KOL slug, but
    // LINE Notify was shut down on 2025-03-31 and that push has been silently
    // going nowhere since. Those two fields are now rows in this email instead,
    // so no information was lost and the admin still gets exactly one message.
    try {
      const adminEmails = parseRecipients(await getSetting("notifications.admin_email"))
      if (adminEmails.length > 0) {
        const kolSlug = (order as { attributed_kol_slug?: string | null })
          .attributed_kol_slug ?? null
        const subject = `【誠真生活】新訂單 ${order.order_number} — NT$ ${totalTwd}`
        const html = `
          <div style="font-family: -apple-system, sans-serif; max-width:600px;">
            <h2 style="color:#10305a;margin:0 0 8px">新訂單通知</h2>
            <p style="color:#687279;margin:0 0 24px">付款已完成，請準備出貨。</p>
            <table style="border-collapse:collapse;width:100%;font-size:14px;">
              <tr><td style="padding:6px 0;color:#687279;width:120px">訂單編號</td><td style="font-family:monospace;font-weight:600">${order.order_number}</td></tr>
              <tr><td style="padding:6px 0;color:#687279">總金額</td><td style="font-weight:600;color:#10305a">NT$ ${totalTwd}</td></tr>
              <tr><td style="padding:6px 0;color:#687279">顧客</td><td>${esc(userEmail ?? "guest")}</td></tr>
              <tr><td style="padding:6px 0;color:#687279">收件人</td><td>${customerName}</td></tr>
              <tr><td style="padding:6px 0;color:#687279">電話</td><td><a href="tel:${s.phone ?? ""}">${s.phone ?? "—"}</a></td></tr>
              <tr><td style="padding:6px 0;color:#687279;vertical-align:top">取貨</td><td>${pickupInfo}</td></tr>
              <tr><td style="padding:6px 0;color:#687279;vertical-align:top">商品</td><td style="white-space:pre-line">${itemLines || "—"}</td></tr>
              ${kolSlug ? `<tr><td style="padding:6px 0;color:#687279">來自 KOL</td><td style="font-weight:600">${esc(kolSlug)}</td></tr>` : ""}
              ${(order as any).notes ? `<tr><td style="padding:6px 0;color:#687279;vertical-align:top">顧客備註</td><td style="white-space:pre-line;color:#b45309;font-weight:600">${(order as any).notes}</td></tr>` : ""}
            </table>
            <p style="margin:24px 0 0;font-size:13px;color:#687279">進管理後台處理 → <a href="https://realreal-store.vercel.app/admin/orders" style="color:#10305a">/admin/orders</a></p>
          </div>
        `
        await sendEmail({ to: adminEmails, subject, html })
      }
    } catch (err) {
      console.warn("[post-payment] admin notification failed (non-fatal):", err)
    }
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

    // De-duplicate on the order: every payment gateway retries its webhook, and
    // admin "retry post-payment" lands here too, so the same order can be
    // enqueued several times within seconds. A stable jobId collapses those into
    // one job.
    //
    // ⚠️ This is a courtesy, NOT the safety mechanism. BullMQ re-delivers
    // *stalled* jobs (a job whose worker died mid-flight) under the SAME id, and
    // that re-delivery is exactly the case that used to open a second real
    // invoice. Duplicate issuance is prevented in the database by
    // claim_invoice_issue (migration 0049); never rely on this line for it.
    //
    // removeOnComplete/removeOnFail matter: BullMQ refuses an add() whose jobId
    // still exists in ANY set, so a retained completed/failed job would block
    // every future enqueue for this order. Failures stay visible in
    // invoices.error_message and Sentry, not in the failed set.
    await invoiceQueue.add(
      "issue",
      { orderId },
      {
        // '-'-joined, never ':' — BullMQ rejects a custom jobId containing ':'
        // ("Custom Id cannot contain :"), which would throw and skip enqueuing
        // the invoice for every paid order. Still stable per order (dedup intact).
        jobId: `invoice-order-${orderId}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 60000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
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
      // New formula: (結帳金額 - 80) × 會員百分比 = 點數
      // 結帳金額 = order.total (actual amount paid including shipping)
      // -80 = shipping deduction (standard fee across all methods)
      const totalTwd = Number((order as { total?: number | string | null }).total ?? 0)
      const earnBaseTwd = Math.max(0, totalTwd - 80)

      // Grant earned points: base = total paid minus shipping fee (80).
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

/**
 * Notification chain for CVS COD (超商取貨付款) orders, fired at checkout time.
 *
 * Why a separate function: COD doesn't charge at checkout, so the regular
 * post-payment chain runs WITHOUT email/admin/LINE — those happen here instead
 * because admin needs to ship BEFORE the customer can pay at pickup. Invoice /
 * points / tier upgrade still wait for the actual payment-at-pickup webhook
 * (ecpay-logistics delivered → enqueuePostPaymentJobs).
 *
 * Customer wording: "訂單已成立，請至超商完成取貨付款" (not "付款成功").
 * Admin wording: "新訂單 — 超商取貨付款，請備貨出貨" (not "付款已完成").
 */
export async function notifyOrderPlacedCod(orderId: string) {
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, order_number, total, guest_email, user_id, attributed_kol_slug, notes",
    )
    .eq("id", orderId)
    .single()

  if (!order) {
    console.warn(`[order-placed-cod] order ${orderId} not found, skipping`)
    return
  }

  const totalTwd = Number(order.total ?? 0)

  // Resolve recipient: registered user or guest email
  let userEmail: string | undefined
  if (order.user_id) {
    try {
      const { data } = await supabase.auth.admin.getUserById(order.user_id)
      userEmail = data?.user?.email ?? undefined
    } catch { /* ignore */ }
  }
  const recipientEmail =
    userEmail ?? ((order as { guest_email?: string | null }).guest_email as string | undefined)

  // Pull shipping address + items for the body
  const [{ data: shippingRow }, { data: items }] = await Promise.all([
    supabase
      .from("order_addresses")
      .select("name, phone, address_type, address, cvs_store_id, cvs_type")
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
      const variant =
        snap.variant_name && snap.variant_name !== "預設"
          ? `（${snap.variant_name}）`
          : ""
      return `  • ${name}${variant} × ${it.qty} = NT$ ${Number(it.unit_price) * Number(it.qty)}`
    })
    .join("\n")

  const s: any = shippingRow ?? {}
  const cvsChain = s.cvs_type === "family" ? "全家" : "7-11"
  const cvsLine =
    s.address_type === "cvs"
      ? `${cvsChain} ${s.address ?? ""} (${s.cvs_store_id ?? ""})`
      : "—"

  // --- Customer email: order-placed (COD) ---
  if (recipientEmail) {
    try {
      const subject = `【誠真生活】訂單已成立 #${order.order_number} — 請至超商取貨付款`
      const html = `
        <div style="font-family: -apple-system, sans-serif; max-width:600px; color:#1a1a1a;">
          <h1 style="color:#10305a; border-bottom:2px solid #10305a; padding-bottom:8px;">誠真生活 RealReal</h1>
          <p>親愛的 ${s.name ?? "顧客"}，</p>
          <p>感謝您的訂購！您的訂單已成立。</p>
          <table style="border-collapse:collapse; width:100%; font-size:14px; margin:16px 0;">
            <tr><td style="padding:6px 0; color:#687279; width:100px; vertical-align:top;">訂單編號</td><td style="font-family:monospace; font-weight:600;">${order.order_number}</td></tr>
            <tr><td style="padding:6px 0; color:#687279; vertical-align:top;">應付金額</td><td style="font-weight:600; color:#10305a;">NT$ ${totalTwd}</td></tr>
            <tr><td style="padding:6px 0; color:#687279; vertical-align:top;">付款方式</td><td>超商取貨付款</td></tr>
            <tr><td style="padding:6px 0; color:#687279; vertical-align:top;">取件門市</td><td>${cvsLine}</td></tr>
            <tr><td style="padding:6px 0; color:#687279; vertical-align:top;">商品</td><td style="white-space:pre-line;">${itemLines || "—"}</td></tr>
          </table>
          <p style="line-height:1.6;">
            訂單將於 2–5 個工作天備貨出貨，包裹到達門市後將以簡訊通知您取貨，<br/>
            請攜帶手機至門市出示取件條碼並完成付款。
          </p>
          <p>如需查詢訂單狀態，請聯絡客服。</p>
          <hr style="margin:24px 0; border:none; border-top:1px solid #eee;">
          <p style="font-size:13px; color:#555; line-height:2;">
            誠真生活 | <a href="https://realreal.cc" style="color:#10305a;">realreal.cc</a><br>
            Email: <a href="mailto:love@realreal.cc" style="color:#10305a;">love@realreal.cc</a><br>
            Line 真人客服: @900kevgi<br>
            Tel: 02-66093066
          </p>
        </div>
      `
      await sendEmail({ to: recipientEmail, subject, html })
    } catch (err) {
      console.warn("[order-placed-cod] customer email send failed (non-fatal):", err)
    }
  } else {
    console.warn(`[order-placed-cod] no email for order ${orderId}, skipping customer email`)
  }

  // --- Admin "new order — COD" notification ---
  //
  // Single admin message per order. The former LINE Notify push that followed
  // this email died with the LINE Notify service (2025-03-31); its two unique
  // fields (顧客 email, KOL slug) are rows in this email now.
  try {
    const adminEmails = parseRecipients(await getSetting("notifications.admin_email"))
    if (adminEmails.length > 0) {
      const kolSlug = (order as { attributed_kol_slug?: string | null })
        .attributed_kol_slug ?? null
      const subject = `【誠真生活】新訂單 ${order.order_number}（超商取貨付款）— NT$ ${totalTwd}`
      const html = `
        <div style="font-family: -apple-system, sans-serif; max-width:600px;">
          <h2 style="color:#10305a; margin:0 0 8px;">新訂單通知（超商取貨付款）</h2>
          <p style="color:#687279; margin:0 0 24px;">訂單已成立，請備貨並建立物流；客人取貨時於超商付款。</p>
          <table style="border-collapse:collapse; width:100%; font-size:14px;">
            <tr><td style="padding:6px 0; color:#687279; width:120px;">訂單編號</td><td style="font-family:monospace; font-weight:600;">${order.order_number}</td></tr>
            <tr><td style="padding:6px 0; color:#687279;">應收金額（COD）</td><td style="font-weight:600; color:#10305a;">NT$ ${totalTwd}</td></tr>
            <tr><td style="padding:6px 0; color:#687279;">顧客</td><td>${esc(userEmail ?? "guest")}</td></tr>
            <tr><td style="padding:6px 0; color:#687279;">收件人</td><td>${s.name ?? "—"}</td></tr>
            <tr><td style="padding:6px 0; color:#687279;">電話</td><td><a href="tel:${s.phone ?? ""}">${s.phone ?? "—"}</a></td></tr>
            <tr><td style="padding:6px 0; color:#687279; vertical-align:top;">取件門市</td><td>${cvsLine}</td></tr>
            <tr><td style="padding:6px 0; color:#687279; vertical-align:top;">商品</td><td style="white-space:pre-line;">${itemLines || "—"}</td></tr>
            ${kolSlug ? `<tr><td style="padding:6px 0; color:#687279;">來自 KOL</td><td style="font-weight:600;">${esc(kolSlug)}</td></tr>` : ""}
            ${(order as any).notes ? `<tr><td style="padding:6px 0; color:#687279; vertical-align:top;">顧客備註</td><td style="white-space:pre-line; color:#b45309; font-weight:600;">${(order as any).notes}</td></tr>` : ""}
          </table>
          <p style="margin:24px 0 0; font-size:13px; color:#687279;">進管理後台處理 → <a href="https://realreal-store.vercel.app/admin/orders" style="color:#10305a;">/admin/orders</a></p>
        </div>
      `
      await sendEmail({ to: adminEmails, subject, html })
    }
  } catch (err) {
    console.warn("[order-placed-cod] admin notification failed (non-fatal):", err)
  }
}
