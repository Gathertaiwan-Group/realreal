import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

/**
 * /my-account layout — auth gate only.
 *
 * The sidebar that lived here was removed as part of the single-page
 * account redesign (spec: 2026-05-30-customer-account-simplification-design).
 * The dashboard, orders list, and subscriptions are now reached from
 * /my-account itself; the other deep links live under their own routes
 * with breadcrumbs back here.
 */
export default async function MyAccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login?redirect=/my-account")

  return <div className="min-h-screen bg-zinc-50">{children}</div>
}
