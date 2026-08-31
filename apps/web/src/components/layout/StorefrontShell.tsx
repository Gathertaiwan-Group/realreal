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
//
// Methods sharing a threshold are merged into ONE message: when all three match
// (the current setting — everything at 999) the bar says it once rather than
// scrolling the same fact past the reader three times. Only a genuine
// difference in thresholds earns a separate line.
function shippingMessages(s: ShippingConfig | null): string[] {
  if (!s) return []

  const methods: Array<{ label: string; threshold: number }> = [
    { label: "超商取貨", threshold: s.cvs.free_threshold },
    { label: "超商取貨付款", threshold: s.cvsCod.free_threshold },
    { label: "宅配", threshold: s.home.free_threshold },
  ]

  // Group by threshold, preserving the order thresholds first appear.
  const groups = new Map<number, string[]>()
  for (const m of methods) {
    const bucket = groups.get(m.threshold)
    if (bucket) bucket.push(m.label)
    else groups.set(m.threshold, [m.label])
  }

  return Array.from(groups.entries()).map(([threshold, labels]) =>
    labels.length === methods.length
      ? `全站消費滿${threshold}元免運`
      : `${labels.join("、")}滿${threshold}元免運`,
  )
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
