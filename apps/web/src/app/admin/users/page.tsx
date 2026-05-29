import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import RoleSelect from "./_components/RoleSelect"

export const metadata = { title: "使用者管理 | Admin" }

interface UserRow {
  id: string
  display_name: string | null
  role: string
  created_at: string
}

const ROLE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  editor: "secondary",
  viewer: "outline",
}

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/auth/login?redirect=/admin/users")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (profile?.role !== "admin") redirect("/admin")

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ""
  let users: UserRow[] = []
  try {
    const res = await fetch(`${API_URL}/admin/users`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (res.ok) {
      const json = await res.json()
      users = Array.isArray(json) ? json : (json.data ?? json.users ?? [])
    }
  } catch {
    // fallback to empty
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#10305a]">使用者管理</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-[#10305a]">所有使用者</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-[#687279]">尚無使用者資料</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-[#687279]">
                    <th className="pb-2 pr-4 font-medium">名稱</th>
                    <th className="pb-2 pr-4 font-medium">角色</th>
                    <th className="pb-2 pr-4 font-medium">建立時間</th>
                    <th className="pb-2 font-medium">變更角色</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 text-[#10305a]">
                        {u.display_name || "(未設定)"}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={ROLE_VARIANT[u.role] ?? "outline"}>
                          {u.role}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-[#687279]">
                        {new Date(u.created_at).toLocaleDateString("zh-TW")}
                      </td>
                      <td className="py-3">
                        <RoleSelect userId={u.id} currentRole={u.role} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
