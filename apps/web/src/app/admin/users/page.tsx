import { redirect } from "next/navigation"

/**
 * Legacy /admin/users team-list route. The simplification redesign
 * moved team CRUD under 設定 → 團隊成員 (with proper add/remove flows).
 */
export default function AdminUsersRedirect() {
  redirect("/admin/settings/team")
}
