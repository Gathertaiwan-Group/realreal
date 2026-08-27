"use client"

import { usePathname } from "next/navigation"
import { Header } from "./Header"
import { Footer } from "./Footer"
import type { Category } from "@/lib/catalog"

function AnnouncementBar() {
  const messages = [
    "加入會員立即享首購折50元",
    "超商取貨滿649免運",
    "宅配、超商取貨付款滿999免運",
    "每週三超商取貨滿499免運",
    "銀杏水蜜桃口味新上市",
  ]
  const items = [...messages, ...messages]

  return (
    <div className="overflow-hidden bg-[#10305a] text-white py-2 text-sm">
      <div className="flex animate-marquee whitespace-nowrap">
        {items.map((msg, i) => (
          <span key={i} className="mx-8 inline-flex items-center gap-2">
            <span className="text-yellow-300">★</span>
            {msg}
          </span>
        ))}
      </div>
    </div>
  )
}

export function StorefrontShell({
  children,
  categories,
  headerUser,
}: {
  children: React.ReactNode
  categories: Category[]
  headerUser: { initial: string } | null
}) {
  const pathname = usePathname()
  const isAdmin = pathname.startsWith("/admin")

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <>
      <AnnouncementBar />
      <Header categories={categories} headerUser={headerUser} />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer />
    </>
  )
}
