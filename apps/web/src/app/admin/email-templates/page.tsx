import { redirect } from "next/navigation"

/**
 * Legacy /admin/email-templates list route. The simplification redesign
 * moved this under 設定 → Email 模板. The individual editor
 * /admin/email-templates/[key] remains where it is.
 */
export default function AdminEmailTemplatesRedirect() {
  redirect("/admin/settings/email-templates")
}
