/**
 * Email sender — direct send (no BullMQ/Redis required).
 * Templates are rendered to HTML and sent via Gmail SMTP.
 * Supports editable templates from site_contents (CMS) with fallback to hardcoded render functions.
 */
import { sendEmail } from "../lib/email"
import { supabase } from "../lib/supabase"
import { renderOrderConfirmation } from "../emails/OrderConfirmation"
import { renderPaymentConfirmed } from "../emails/PaymentConfirmed"
import { renderOrderShipped } from "../emails/OrderShipped"
import { renderPaymentReminder } from "../emails/PaymentReminder"
import { renderTierUpgrade } from "../emails/TierUpgrade"
import { renderTierRenewed } from "../emails/TierRenewed"
import { renderTierDowngraded } from "../emails/TierDowngraded"
import { renderSubscriptionBilled } from "../emails/SubscriptionBilled"
import { renderSubscriptionFailed } from "../emails/SubscriptionFailed"

export type EmailJobData =
  | { template: "order-confirmation"; to: string; data: { orderNumber: string; items: any[]; total: string; address: string } }
  | { template: "payment-confirmed"; to: string; data: { orderNumber: string; amount: string; customerName: string; items: Array<{ name: string; qty: number; price: string }>; pickupInfo: string } }
  | { template: "order-shipped"; to: string; data: { orderNumber: string; customerName: string } }
  | { template: "payment-reminder"; to: string; data: { orderNumber: string; customerName: string; amount: string; items: Array<{ name: string; qty: number; price: string }>; pickupInfo: string; repayUrl: string } }
  | { template: "tier-upgrade"; to: string; data: { newTier: string; discountRate: number; perks: string[] } }
  | { template: "tier-renewed"; to: string; data: { tierName: string; newExpiresAt: string; perks: string[] } }
  | { template: "tier-downgraded"; to: string; data: { fromTier: string; toTier: string; nextRequalifyAmount: number; toPerks: string[] } }
  | { template: "subscription-billed"; to: string; data: { planName: string; amount: string; nextBillingDate: string; orderNumber: string } }
  | { template: "subscription-failed"; to: string; data: { planName: string; retryDate: string; manageUrl: string } }

/** Replace {{variable}} placeholders with actual data values */
function replaceTemplateVars(html: string, data: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "")
}

/** Map template name to site_contents key */
const TEMPLATE_KEY_MAP: Record<string, string> = {
  "order-confirmation": "email_order_confirmation",
  "payment-confirmed": "email_payment_confirmed",
  "order-shipped": "email_order_shipped",
  "tier-upgrade": "email_tier_upgrade",
  "tier-renewed": "email_tier_renewed",
  "tier-downgraded": "email_tier_downgraded",
  "subscription-billed": "email_subscription_billed",
  "subscription-failed": "email_subscription_failed",
}

/**
 * Try to load an email template from site_contents (CMS).
 * Returns null if not found so caller can fall back to hardcoded templates.
 */
async function loadTemplateFromDB(
  templateName: string,
  vars: Record<string, string>,
): Promise<{ subject: string; html: string } | null> {
  const key = TEMPLATE_KEY_MAP[templateName]
  if (!key) return null

  const { data, error } = await supabase
    .from("site_contents")
    .select("value")
    .eq("key", key)
    .single()

  if (error || !data) return null

  const tpl = data.value as { subject?: string; body_html?: string }
  if (!tpl.subject || !tpl.body_html) return null

  return {
    subject: replaceTemplateVars(tpl.subject, vars),
    html: replaceTemplateVars(tpl.body_html, vars),
  }
}

/** Flatten job data into a simple string record for template variable replacement */
function flattenData(template: string, data: Record<string, any>): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" || typeof v === "number") {
      vars[k] = String(v)
    }
  }
  // Special computed fields
  if (template === "tier-upgrade" && typeof data.discountRate === "number") {
    vars.discountPercent = String(Math.round(data.discountRate * 100))
  }
  if ((template === "tier-upgrade" || template === "tier-renewed") && Array.isArray(data.perks)) {
    const perkItems = data.perks.map((p: string) => `<li style="padding:4px 0">${p}</li>`).join("")
    vars.perksSection = data.perks.length > 0
      ? `<h3>您的專屬權益：</h3><ul>${perkItems}</ul>`
      : ""
  }
  if (template === "tier-renewed" && typeof data.newExpiresAt === "string") {
    const d = new Date(data.newExpiresAt)
    vars.formattedExpiresAt = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`
  }
  if (template === "tier-downgraded" && Array.isArray(data.toPerks)) {
    const perkItems = data.toPerks.map((p: string) => `<li style="padding:4px 0">${p}</li>`).join("")
    vars.toPerksSection = data.toPerks.length > 0
      ? `<h3>您目前的會員權益：</h3><ul>${perkItems}</ul>`
      : ""
  }
  if (template === "tier-downgraded" && typeof data.nextRequalifyAmount === "number") {
    vars.formattedRequalifyAmount = data.nextRequalifyAmount.toLocaleString("en-US")
  }
  if (template === "order-confirmation" && Array.isArray(data.items)) {
    vars.itemRows = data.items.map((item: any) =>
      `<tr><td style="padding:8px;border-bottom:1px solid #eee">${item.name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${item.qty}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">NT$${item.price}</td></tr>`
    ).join("")
  }
  return vars
}

/**
 * Render an email template and send it directly via Gmail SMTP.
 * First tries to load an editable template from site_contents (CMS).
 * Falls back to hardcoded render functions if not found in DB.
 */
export async function renderAndSendEmail(jobData: EmailJobData): Promise<void> {
  const { template, to, data } = jobData

  // Try DB template first (CMS override)
  const vars = flattenData(template, data)
  const dbTemplate = await loadTemplateFromDB(template, vars)

  if (dbTemplate) {
    await sendEmail({ to, subject: dbTemplate.subject, html: dbTemplate.html })
    return
  }

  // Fallback to hardcoded render functions
  let subject: string
  let html: string

  switch (template) {
    case "order-confirmation":
      subject = `訂單確認 #${data.orderNumber}`
      html = renderOrderConfirmation(data)
      break
    case "payment-confirmed":
      subject = `付款成功 #${data.orderNumber}`
      html = renderPaymentConfirmed(data)
      break
    case "order-shipped":
      subject = `您的訂單已出貨 #${data.orderNumber}`
      html = renderOrderShipped(data)
      break
    case "payment-reminder":
      subject = `【誠真生活】您的訂單尚未完成付款 #${data.orderNumber}`
      html = renderPaymentReminder(data)
      break
    case "tier-upgrade":
      subject = `恭喜升級為${data.newTier}！`
      html = renderTierUpgrade(data)
      break
    case "tier-renewed":
      subject = `恭喜續約 ${data.tierName} 等級`
      html = renderTierRenewed(data)
      break
    case "tier-downgraded":
      subject = `會員等級調整通知`
      html = renderTierDowngraded(data)
      break
    case "subscription-billed":
      subject = `訂閱扣款成功 — ${data.planName}`
      html = renderSubscriptionBilled(data)
      break
    case "subscription-failed":
      subject = `訂閱扣款失敗 — ${data.planName}`
      html = renderSubscriptionFailed(data)
      break
    default:
      console.error(`[email-sender] Unknown template: ${(jobData as any).template}`)
      return
  }

  await sendEmail({ to, subject, html })
}
