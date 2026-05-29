import { redirect } from "next/navigation"

/**
 * Legacy /my-account/membership route. Tier info now lives in the
 * hero card on /my-account. The standalone page added no detail
 * beyond what the dashboard surfaces.
 */
export default function MyAccountMembershipRedirect() {
  redirect("/my-account")
}
