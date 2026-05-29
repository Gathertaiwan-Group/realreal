import { redirect } from "next/navigation"

/**
 * Legacy /my-account/addresses route. Address CRUD moved into the
 * 帳號設定 accordion on /my-account. The stub forwards old links so
 * bookmarks/emails don't 404.
 */
export default function MyAccountAddressesRedirect() {
  redirect("/my-account?section=account-settings")
}
