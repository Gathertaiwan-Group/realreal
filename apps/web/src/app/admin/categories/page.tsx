import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AdminTabs } from "../_components/AdminTabs"
import { CategoriesClient, type CategoryRow } from "./_client"
import { normalizeAdminCategories } from "@/lib/admin-categories"

export const metadata = { title: "分類管理 | Admin" }

interface CategoriesResponse {
  data?: CategoryRow[]
  categories?: CategoryRow[]
}

export default async function AdminCategoriesPage() {
  const API_URL =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.RAILWAY_API_URL ??
    "http://localhost:4000"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()
  if (profile?.role !== "admin" && profile?.role !== "editor") redirect("/")

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? ""

  let initialData: CategoryRow[] = []
  try {
    let res = await fetch(`${API_URL}/admin/categories`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) {
      res = await fetch(`${API_URL}/categories`, { cache: "no-store" })
    }
    if (res.ok) {
      const json: CategoriesResponse = await res.json()
      initialData = normalizeAdminCategories(json.data ?? json.categories ?? [])
    }
  } catch {
    // API unavailable — render empty state
  }

  return (
    <div className="space-y-6">
      <AdminTabs tabs={[{ href: "/admin/products", label: "商品" }, { href: "/admin/categories", label: "分類" }, { href: "/admin/reviews", label: "評價" }]} />
      <div>
        <h1 className="mb-2 text-xl font-semibold text-[#10305a]">分類管理</h1>
        <p className="text-sm text-zinc-500">
          建立、編輯、排序商品分類；最多兩層（頂層 + 子分類）。刪除受保護：若分類底下還有商品或關聯行銷活動，將無法刪除。
        </p>
      </div>

      <CategoriesClient initialData={initialData} />
    </div>
  )
}
