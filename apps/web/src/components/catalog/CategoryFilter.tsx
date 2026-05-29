"use client"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import type { Category } from "@/lib/catalog"

interface CategoryFilterProps {
  categories: Category[]
  /** When rendered as sidebar, applies vertical layout */
  layout?: "horizontal" | "sidebar"
}

export function CategoryFilter({ categories, layout = "horizontal" }: CategoryFilterProps) {
  const router = useRouter()
  const sp = useSearchParams()
  const current = sp.get("category")

  function navigate(slug?: string) {
    const params = new URLSearchParams(sp.toString())
    if (slug) {
      params.set("category", slug)
    } else {
      params.delete("category")
    }
    // Reset to page 1 when changing category
    params.delete("page")
    router.push(`/shop?${params.toString()}`)
  }

  const isSidebar = layout === "sidebar"

  return (
    <nav
      className={cn(
        isSidebar
          ? "flex flex-col gap-1"
          : "flex gap-6 overflow-x-auto pb-2 scrollbar-thin -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap md:overflow-visible md:pb-0 justify-center border-b border-gray-200"
      )}
      aria-label="商品分類"
    >
      <TabButton
        active={!current}
        onClick={() => navigate()}
        layout={layout}
      >
        全部商品
      </TabButton>
      {categories
        .filter((cat) => cat.slug !== "all")
        .map((cat) => (
          <TabButton
            key={cat.id}
            active={current === cat.slug}
            onClick={() => navigate(cat.slug)}
            count={cat.product_count}
            layout={layout}
          >
            {cat.name}
          </TabButton>
        ))}
    </nav>
  )
}

function TabButton({
  active,
  onClick,
  children,
  count,
  layout,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  count?: number
  layout: "horizontal" | "sidebar"
}) {
  const isSidebar = layout === "sidebar"

  if (isSidebar) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "flex items-center justify-between w-full px-3 py-2 text-sm rounded-md transition-colors text-left",
          active
            ? "font-medium"
            : "hover:bg-gray-50"
        )}
        style={{ color: "#10305a" }}
      >
        <span>{children}</span>
        {count != null && (
          <span className="text-xs tabular-nums" style={{ color: "#687279" }}>
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 pb-3 text-sm font-medium transition-all border-b-2 -mb-[1px]",
        active
          ? "border-[#10305a]"
          : "border-transparent hover:border-gray-300"
      )}
      style={{ color: active ? "#10305a" : "#687279" }}
    >
      {children}
      {count != null && (
        <span className="ml-1 text-xs" style={{ color: "#687279" }}>
          ({count})
        </span>
      )}
    </button>
  )
}
