import Link from "next/link"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AdminTabs } from "../_components/AdminTabs"
import AdminProductsClient from "./_client"

const PRODUCT_TABS = [
  { href: "/admin/products", label: "商品" },
  { href: "/admin/categories", label: "分類" },
  { href: "/admin/reviews", label: "評價" },
]

export const metadata = { title: "商品管理 | Admin" }

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  const params = await searchParams
  const archived = params.archived === "1"

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single()
  if (profile?.role !== "admin") redirect("/")

  let query = supabase
    .from("products")
    .select("id, name, slug, is_active, is_featured, is_addon, display_priority, created_at, deleted_at")
    .order("created_at", { ascending: false })
    .limit(100)

  // Default view shows only active products; ?archived=1 shows only archived ones.
  query = archived
    ? query.not("deleted_at", "is", null)
    : query.is("deleted_at", null)

  const { data: products } = await query

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">商品{archived ? "（已封存）" : ""}</h1>
        <Link href="/admin/products/new"><Button>新增商品</Button></Link>
      </div>
      <AdminTabs tabs={PRODUCT_TABS} />
      <AdminProductsClient initialProducts={(products ?? []) as never} archived={archived} />
    </div>
  )
}
