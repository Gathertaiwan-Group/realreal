"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ShoppingCart,
  Package,
  Users,
  FileText,
  LayoutDashboard,
  Megaphone,
  Settings,
  Share2,
  Menu,
  X,
  Store,
} from "lucide-react"
import { LogoutButton } from "./LogoutButton"

type Role = "admin" | "editor" | "viewer"

const NAV_ITEMS = [
  { href: "/admin", label: "概覽", icon: LayoutDashboard, roles: ["admin", "editor"] },
  { href: "/admin/orders", label: "訂單", icon: ShoppingCart, roles: ["admin", "editor"] },
  { href: "/admin/products", label: "商品", icon: Package, roles: ["admin", "editor"] },
  { href: "/admin/customers", label: "客戶", icon: Users, roles: ["admin", "editor"] },
  { href: "/admin/wholesale", label: "通路商", icon: Store, roles: ["admin"] },
  { href: "/admin/campaigns", label: "行銷", icon: Megaphone, roles: ["admin", "editor"] },
  { href: "/admin/kols", label: "聯盟行銷", icon: Share2, roles: ["admin"] },
  { href: "/admin/posts", label: "文章", icon: FileText, roles: ["admin", "editor"] },
  { href: "/admin/settings", label: "設定", icon: Settings, roles: ["admin"] },
] as const

interface Props {
  role: Role
  userEmail: string
}

export function AdminSidebar({ role, userEmail }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (item.roles as readonly string[]).includes(role),
  )

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin"
    return pathname.startsWith(href)
  }

  const NavLinks = ({ onClick }: { onClick?: () => void }) => (
    <>
      {visibleItems.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={onClick}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-sm transition-colors"
          style={{
            color: isActive(href) ? "white" : "rgba(255,255,255,0.7)",
            backgroundColor: isActive(href) ? "rgba(255,255,255,0.15)" : undefined,
          }}
        >
          <Icon className="w-4 h-4 shrink-0" />
          {label}
        </Link>
      ))}
    </>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 bg-[#10305a] flex-col min-h-screen">
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          <span className="font-semibold text-sm text-white">誠真生活 管理後台</span>
        </div>
        <nav className="flex-1 py-4 space-y-0.5 px-2">
          <NavLinks />
        </nav>
        <div className="border-t border-white/10">
          <div className="px-4 pt-3 pb-1 text-xs text-white/50 truncate">{userEmail}</div>
          <div className="px-2 pb-3">
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Mobile header bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[#10305a] flex items-center justify-between px-4 shadow-md">
        <span className="font-semibold text-sm text-white">誠真生活 管理後台</span>
        <button
          onClick={() => setOpen(true)}
          className="text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="開啟選單"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-64 h-full bg-[#10305a] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-14 flex items-center justify-between px-4 border-b border-white/10">
              <span className="font-semibold text-sm text-white">誠真生活 管理後台</span>
              <button
                onClick={() => setOpen(false)}
                className="text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
              <NavLinks onClick={() => setOpen(false)} />
            </nav>
            <div className="border-t border-white/10">
              <div className="px-4 pt-3 pb-1 text-xs text-white/50 truncate">{userEmail}</div>
              <div className="px-2 pb-3">
                <LogoutButton />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
