import Link from "next/link"
import { getProducts } from "@/lib/catalog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AdminTabs } from "../_components/AdminTabs"

const PRODUCT_TABS = [
  { href: "/admin/products", label: "商品" },
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
      <div className="border rounded-lg divide-y">
        {products.length === 0 && <p className="p-4 text-zinc-500">尚無商品</p>}
        {products.map(p => (
          <div key={p.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-sm text-zinc-500">{p.slug}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "上架" : "下架"}</Badge>
              <Link href={`/admin/products/${p.id}`}><Button variant="outline" size="sm">編輯</Button></Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
