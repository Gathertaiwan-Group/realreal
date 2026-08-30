/**
 * Shared "加入會員" HTML block appended to guest-order confirmation emails.
 * Reused by both send paths for a freshly-placed order:
 *   - PaymentConfirmed.ts (online-paid orders — LinePay / PChomePay / JKOPay)
 *   - enqueue-post-payment.ts's notifyOrderPlacedCod (超商取貨付款)
 * Links back to /checkout/confirm?order=<orderNumber>, which already renders
 * GuestRegisterCard (one-click register-from-guest + auto-claim past orders)
 * for any guest order — no new page or backend route needed.
 *
 * See docs/superpowers/specs/2026-08-30-guest-checkout-membership-awareness-design.md
 */
export function renderMembershipCta(orderNumber: string, extraParams?: Record<string, string>): string {
  const params = new URLSearchParams({ order: orderNumber, ...extraParams })
  // URLSearchParams#toString() encodes spaces as "+" (application/x-www-form-urlencoded),
  // but the previous encodeURIComponent-based implementation produced "%20" —
  // normalize back to "%20" so existing links/tests keep the same encoding.
  const url = `https://realreal.cc/checkout/confirm?${params.toString().replace(/\+/g, "%20")}`
  return `<div style="background:#f5f8fc;border:1px solid #dbe6f3;border-radius:8px;padding:16px;margin:20px 0">
    <p style="margin:0 0 8px;font-weight:600;color:#10305a">💡 想讓這筆訂單也算進會員？</p>
    <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6">
      加入會員即可累積公益存款點數、下次購物更快結帳，也能隨時查詢這筆訂單狀態。
    </p>
    <a href="${url}" style="display:inline-block;background:#10305a;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:14px;font-weight:600">加入會員 →</a>
  </div>`
}
