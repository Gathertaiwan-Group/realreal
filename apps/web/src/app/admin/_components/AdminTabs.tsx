"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

export interface AdminTab {
  href: string
  label: string
  count?: number
}

/**
 * Shared link-tab strip used at the top of consolidated admin pages
 * (訂單 ↔ 訂閱, 商品 ↔ 評價, 行銷 ↔ 優惠券 / 活動, 設定 ↔ 團隊 / Email 模板).
 *
 * Each tab is a real route — the tab strip just highlights the active
 * one based on `pathname`. Keeps deep links, browser back, and bookmark
 * semantics intact while still feeling tabbed.
 */
export function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const pathname = usePathname()
  return (
    <div className="mb-6 border-b border-zinc-200">
      <div className="flex gap-1">
        {tabs.map((t) => {
          const active = pathname === t.href
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "text-[#10305a]"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={`ml-1.5 inline-flex items-center rounded-full px-1.5 text-xs ${
                    active
                      ? "bg-[#10305a] text-white"
                      : "bg-zinc-100 text-zinc-500"
                  }`}
                >
                  {t.count}
                </span>
              )}
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#10305a]" />
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
