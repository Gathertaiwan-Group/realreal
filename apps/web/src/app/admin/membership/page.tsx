import { redirect } from "next/navigation"

/**
 * Legacy `/admin/membership` has moved to `/admin/marketing/tiers`
 * (consolidated into the 行銷 tab strip per the 2026-05-30 spec).
 * Keep this stub so existing bookmarks / external links keep working.
 */
export default function AdminMembershipRedirect() {
  redirect("/admin/marketing/tiers")
}
