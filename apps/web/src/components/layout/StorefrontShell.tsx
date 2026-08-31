"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Header } from "./Header"
import { Footer } from "./Footer"
import { API_URL } from "@/lib/api-url"
import type { Category } from "@/lib/catalog"

type ShippingConfig = {
  cvs: { fee: number; free_threshold: number }
  cvsCod: { fee: number; free_threshold: number }
  home: { fee: number; free_threshold: number }
}

// Free-shipping lines are built from the LIVE thresholds (GET /config), never
// hardcoded. The old hardcoded copy read 649 / 999 while the real settings held
// 650 / 1000, so someone at exactly 999 on 宅配 was promised free shipping and
// charged NT$150 at checkout. Any edit in admin now flows straight through to
// this bar. Until the fetch resolves (or if it fails) the shipping lines are
// simply omitted — a shorter marquee is fine, a wrong number is not.
function shippingMessages(s: ShippingConfig | null): string[] {
  if (!s) return []
  const lines = [`超商取貨滿${s.cvs.free_threshold}免運`]
  // 宅配 and 超商取貨付款 only share a line when their thresholds truly match;
  // they are separate settings and have differed before.
  if (s.home.free_threshold === s.cvsCod.free_threshold) {
    lines.push(`宅配、超商取貨付款滿${s.home.free_threshold}免運`)
  } else {
    lines.push(`宅配滿${s.home.free_threshold}免運`)
    lines.push(`超商取貨付款滿${s.cvsCod.free_threshold}免運`)
  }
  return lines
}

function AnnouncementBar() {
  const [shipping, setShipping] = useState<ShippingConfig | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { shipping?: ShippingConfig | null } | null) => {
        if (!cancelled && json?.shipping) setShipping(json.shipping)
      })
      .catch(() => {
        /* leave shipping null — those lines are omitted rather than wrong */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const messages = [
    "加入會員立即享首購折50元",
    ...shippingMessages(shipping),
    "港澳寄送可運費到付",
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
