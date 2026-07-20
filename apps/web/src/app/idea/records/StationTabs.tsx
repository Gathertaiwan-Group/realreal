"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { STATIONS } from "./stations"

export function StationTabs() {
  const pathname = usePathname()

  return (
    <div className="flex justify-center gap-2 mb-10 flex-wrap">
      {STATIONS.map((s) => {
        const isActive = pathname === `/idea/records/${s.slug}`
        return (
          <Link
            key={s.slug}
            href={`/idea/records/${s.slug}`}
            className="rounded-full px-5 py-2 text-sm font-semibold transition-colors"
            style={{
              backgroundColor: isActive ? "#10305a" : "#f4f2ee",
              color: isActive ? "#fff" : "#687279",
            }}
          >
            {s.tabLabel}
          </Link>
        )
      })}
    </div>
  )
}
