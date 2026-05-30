import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import Link from "next/link"
import { LogoutButton } from "./LogoutButton"
import {
  ShoppingCart,
  Package,
  Folders,
  Users,
  FileText,
  FolderTree,
  LayoutDashboard,
  Megaphone,
  Settings,
} from "lucide-react"

type Role = "admin" | "editor" | "viewer"

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles?: Role[]
}

// 7-item simplified nav per
// docs/superpowers/specs/2026-05-30-admin-simplification-design.md
// Subscriptions merged into 訂單 (tab), 評價 into 商品 (tab), 優惠券+行銷活動 into
// 行銷 (tabs), 數據分析 absorbed into 概覽 (with deep link), Email 模板 + 團隊
// + 系統參數 collapsed into 設定 (tabs).
const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "概覽", icon: LayoutDashboard, roles: ["admin", "editor"] },
  { href: "/admin/orders", label: "訂單", icon: ShoppingCart, roles: ["admin", "editor"] },
  { href: "/admin/products", label: "商品", icon: Package, roles: ["admin", "editor"] },
  { href: "/admin/categories", label: "分類", icon: Folders, roles: ["admin", "editor"] },
  { href: "/admin/customers", label: "客戶", icon: Users, roles: ["admin", "editor"] },
  { href: "/admin/campaigns", label: "行銷", icon: Megaphone, roles: ["admin", "editor"] },
  { href: "/admin/posts", label: "文章", icon: FileText, roles: ["admin", "editor"] },
  { href: "/admin/posts/categories", label: "文章分類", icon: FolderTree, roles: ["admin", "editor"] },
  { href: "/admin/settings", label: "設定", icon: Settings, roles: ["admin"] },
]

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

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(role),
  )

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <aside className="w-56 shrink-0 bg-[#10305a] flex flex-col">
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          <span className="font-semibold text-sm text-white">誠真生活 管理後台</span>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          {visibleItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/10">
          <div className="px-4 pt-3 pb-1 text-xs text-white/50 truncate">{user.email}</div>
          <div className="px-2 pb-3">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  )
}
