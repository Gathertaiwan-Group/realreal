import { Router } from "express"
import { z } from "zod"
import { sendEmail } from "../lib/email"
import { getSetting } from "../lib/settings"

export const contactRouter = Router()

const contactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().max(40).optional().nullable(),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
})

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// POST /contact — public 聯絡表單。寄一封通知信給後台設定的收件人
// (notifications.admin_email)。客人的 Email 放在內文，後台可直接回覆。
contactRouter.post("/", async (req, res) => {
  const parsed = contactSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "欄位格式不正確" })
    return
  }
  const { name, email, phone, subject, message } = parsed.data

  const adminEmail = await getSetting("notifications.admin_email")
  if (!adminEmail) {
    console.warn("[contact] notifications.admin_email 未設定，無法寄出聯絡訊息")
    res.status(500).json({ error: "聯絡信箱未設定，請稍後再試" })
    return
  }

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;">
      <h2 style="color:#10305a;margin:0 0 8px">網站聯絡表單</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:6px 0;color:#687279;width:90px">姓名</td><td style="font-weight:600">${esc(name)}</td></tr>
        <tr><td style="padding:6px 0;color:#687279">Email</td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:6px 0;color:#687279">電話</td><td>${phone ? esc(phone) : "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#687279">主旨</td><td style="font-weight:600">${esc(subject)}</td></tr>
        <tr><td style="padding:6px 0;color:#687279;vertical-align:top">內容</td><td style="white-space:pre-line">${esc(message)}</td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#687279">直接回覆此客人：<a href="mailto:${esc(email)}">${esc(email)}</a></p>
    </div>`

  try {
    await sendEmail({
      to: adminEmail,
      subject: `【誠真生活｜聯絡表單】${subject}`,
      html,
    })
    res.json({ ok: true })
  } catch (err) {
    console.error("[contact] 寄送失敗:", err)
    res.status(502).json({ error: "寄送失敗，請稍後再試" })
  }
})
