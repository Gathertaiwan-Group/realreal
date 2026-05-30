"use client"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import type { Category } from "@/lib/catalog"

interface CategoryFilterProps {
  categories: Category[]
  /** When rendered as sidebar, applies vertical layout */
  layout?: "horizontal" | "sidebar"
}

export function CategoryFilter({ categories, layout = "horizontal" }: CategoryFilterProps) {
  const pathname = usePathname()
  const sp = useSearchParams()
  // Detect current category from /category/<slug> path or ?category=<slug> query.
  // Query param kept for backward compat (spec J §6); tabs link to /category/<slug>
  // (moved out of /shop/<slug> to avoid Next.js dynamic route conflict with the
  // existing /shop/[slug] product detail page).
  const pathSlug = pathname?.startsWith("/category/")
    ? pathname.slice("/category/".length).split("/")[0]
    : undefined
  const querySlug = sp.get("category") ?? undefined
  const current = pathSlug || querySlug

  // "全部商品" returns to /shop (the all-products grid). Individual category tabs
  // link to /category/<slug> — the new landing page from spec J.
  const allHref = "/shop"
  const hrefFor = (slug: string) => `/category/${slug}`

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
      <TabLink
        active={!current}
        href={allHref}
        layout={layout}
      >
        全部商品
      </TabLink>
      {categories
        .filter((cat) => cat.slug !== "all")
        .map((cat) => (
          <TabLink
            key={cat.id}
            active={current === cat.slug}
            href={hrefFor(cat.slug)}
            count={cat.product_count}
            layout={layout}
          >
            {cat.name}
          </TabLink>
        ))}
    </nav>
  )
}

function TabLink({
  active,
  href,
  children,
  count,
  layout,
}: {
  active: boolean
  href: string
  children: React.ReactNode
  count?: number
  layout: "horizontal" | "sidebar"
}) {
  const isSidebar = layout === "sidebar"

  if (isSidebar) {
    return (
      <Link
        href={href}
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
      </Link>
    )
  }

  return (
    <Link
      href={href}
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
    </Link>
  )
}
