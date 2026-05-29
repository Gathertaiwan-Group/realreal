import { redirect } from "next/navigation"

/**
 * Legacy /my-account/profile route. After the single-page redesign
 * the profile editor lives inside the collapsible 帳號設定 section of
 * /my-account. Bookmarks land at the dashboard with that section pre-expanded.
 */
export default function MyAccountProfileRedirect() {
  redirect("/my-account?section=account-settings")
}
