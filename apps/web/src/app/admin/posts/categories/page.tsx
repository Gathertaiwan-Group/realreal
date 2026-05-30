import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { PostCategoriesClient, type PostCategoryRow } from "./_client"

export const metadata = { title: "文章分類 | Admin" }

interface PostCategoriesResponse {
  data?: PostCategoryRow[]
  categories?: PostCategoryRow[]
}

export default async function AdminPostCategoriesPage() {
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

  let initialData: PostCategoryRow[] = []
  try {
    // Prefer admin endpoint (includes post_count); fall back to public list if missing.
    let res = await fetch(`${API_URL}/admin/post-categories`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) {
      res = await fetch(`${API_URL}/post-categories`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
    }
    if (res.ok) {
      const json: PostCategoriesResponse = await res.json()
      initialData = json.data ?? json.categories ?? []
    }
  } catch {
    // API unavailable — render empty state
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-xl font-semibold text-[#10305a]">文章分類</h1>
        <p className="text-sm text-zinc-500">
          建立、編輯、刪除文章分類（單層結構）。若有文章使用該分類，將無法刪除。
        </p>
      </div>

      <PostCategoriesClient initialData={initialData} />
    </div>
  )
}
