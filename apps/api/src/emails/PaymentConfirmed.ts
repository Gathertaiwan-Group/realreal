import { renderMembershipCta } from "./membership-cta"

export function renderPaymentConfirmed(data: {
  orderNumber: string
  amount: string
  customerName: string
  items: Array<{ name: string; qty: number; price: string }>
  pickupInfo: string
  /** Set only for overseas_cod orders — shipping fee notice, mirrors the checkout page's amber box. */
  codNotice?: string
  /**
   * True when the order has no linked member account (guest_email set,
   * user_id null) — shows a "加入會員" CTA.
   *
   * ⚠️ If a `site_contents` row with key `email_payment_confirmed` exists,
   * email-sender.ts's DB-template-override path sends that HTML instead and
   * this CTA never reaches the customer — see docs/superpowers/specs/
   * 2026-08-30-guest-checkout-membership-awareness-design.md and the
   * `email-template-db-override` memory. Confirmed empty as of 2026-08-30.
   */
  isGuestOrder?: boolean
}): string {
  const itemRows = data.items.map(item =>
    `<tr>
      <td style="padding:4px 0;color:#333">${item.name}</td>
      <td style="padding:4px 0;color:#687279;text-align:center;padding-left:12px">× ${item.qty}</td>
      <td style="padding:4px 0;text-align:right;padding-left:12px">NT$${item.price}</td>
    </tr>`
  ).join("")

  const codNoticeHtml = data.codNotice
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:12px;margin:16px 0;font-size:14px">
        📦 ${data.codNotice}
      </div>`
    : ""

  const membershipCtaHtml = data.isGuestOrder ? renderMembershipCta(data.orderNumber) : ""

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px">
    <h1 style="color:#10305a;border-bottom:2px solid #10305a;padding-bottom:8px">誠真生活 RealReal</h1>
    <p>親愛的 ${data.customerName}，</p>
    <p>感謝您的訂購！您的訂單已成立，付款成功。</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 0;color:#687279;width:100px;vertical-align:top">訂單編號</td><td style="padding:6px 0;font-family:monospace;font-weight:bold">${data.orderNumber}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">應付金額</td><td style="padding:6px 0;font-weight:bold;color:#10305a">NT$${data.amount}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">付款方式</td><td style="padding:6px 0">線上付款</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">取貨方式</td><td style="padding:6px 0">${data.pickupInfo}</td></tr>
      <tr><td style="padding:6px 0;color:#687279;vertical-align:top">商品</td><td style="padding:6px 0"><table style="width:100%">${itemRows}</table></td></tr>
    </table>
    ${codNoticeHtml}
    ${membershipCtaHtml}
    <p>訂單將於 2–5 個工作天備貨出貨。</p>
    <p>如需查詢訂單狀態，請聯絡客服。</p>
    <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
    <p style="font-size:13px;color:#555;line-height:2">
      誠真生活 | <a href="https://realreal.cc" style="color:#10305a">realreal.cc</a><br>
      Email: <a href="mailto:love@realreal.cc" style="color:#10305a">love@realreal.cc</a><br>
      Line 真人客服: @900kevgi
    </p>
  </body></html>`
}
