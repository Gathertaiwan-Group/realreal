import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { AdminSidebar } from "./AdminSidebar"

type Role = "admin" | "editor" | "viewer"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login?redirect=/admin")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  const role = (profile?.role ?? "viewer") as Role

  if (role === "viewer") redirect("/")

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <AdminSidebar role={role} userEmail={user.email ?? ""} />
      {/* pt-14 on mobile to clear the fixed header bar; md:pt-0 on desktop */}
      <main className="flex-1 min-w-0 p-4 pt-[72px] md:pt-6 md:p-6">{children}</main>
    </div>
  )
}
