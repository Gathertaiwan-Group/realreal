import Link from "next/link"
import { getProducts } from "@/lib/catalog"
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

export default async function AdminProductsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single()
  if (profile?.role !== "admin") redirect("/")

  const { data: products } = await getProducts({ limit: 100 })

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">商品</h1>
        <Link href="/admin/products/new"><Button>新增商品</Button></Link>
      </div>
      <AdminTabs tabs={PRODUCT_TABS} />
      <AdminProductsClient initialProducts={products as never} />
    </div>
  )
}
