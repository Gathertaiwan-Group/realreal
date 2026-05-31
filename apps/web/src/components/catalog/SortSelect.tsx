"use client"
import { useRouter, useSearchParams } from "next/navigation"
import type { SortOption } from "@/lib/catalog"

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "最新上架" },
  { value: "price_asc", label: "價格低到高" },
  { value: "price_desc", label: "價格高到低" },
  { value: "best_selling", label: "最熱銷" },
]

export function SortSelect() {
  const router = useRouter()
  const sp = useSearchParams()
  const current = sp.get("sort") ?? "price_desc"

  function onChange(value: string) {
    const params = new URLSearchParams(sp.toString())
    if (value === "price_desc") {
      params.delete("sort")
    } else {
      params.set("sort", value)
    }
    params.delete("page")
    router.push(`/shop?${params.toString()}`)
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#10305a]/20 focus:border-[#10305a]"
      style={{ color: "#10305a" }}
      aria-label="排序方式"
    >
      {SORT_OPTIONS.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
