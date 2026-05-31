import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { ReviewsTable } from "./_client"
import { AdminTabs } from "../_components/AdminTabs"

const PRODUCT_TABS = [
  { href: "/admin/products", label: "商品" },
  { href: "/admin/categories", label: "分類" },
  { href: "/admin/reviews", label: "評價" },
]

export const metadata = { title: "評價管理 | Admin" }

type Review = {
  id: string
  product_id: string
  rating: number
  content: string
  author_name: string
  author_email: string
  is_approved: boolean
  created_at: string
  products: { name: string } | null
}

export default async function AdminReviewsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login?redirect=/admin/reviews")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (!profile || !["admin", "editor"].includes(profile.role)) redirect("/")

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token ?? ""

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

  let reviews: Review[] = []
  let total = 0
  try {
    const res = await fetch(`${API_URL}/admin/reviews`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (res.ok) {
      const json = await res.json()
      reviews = json.data ?? []
      total = json.pagination?.total ?? reviews.length
    }
  } catch {
    // API unavailable
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#10305a]">評價</h1>
        <span className="text-sm text-[#687279]">共 {total} 則評價</span>
      </div>
      <AdminTabs tabs={PRODUCT_TABS} />

      <ReviewsTable reviews={reviews} token={token} />
    </div>
  )
}
