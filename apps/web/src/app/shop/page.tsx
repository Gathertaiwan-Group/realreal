import { Suspense } from "react"
import { getCategories, getProducts } from "@/lib/catalog"
import type { SortOption } from "@/lib/catalog"
import { ProductGrid, ProductGridSkeleton } from "@/components/catalog/ProductGrid"
import { CategoryFilter } from "@/components/catalog/CategoryFilter"
import { SortSelect } from "@/components/catalog/SortSelect"
import { Pagination } from "@/components/catalog/Pagination"

export const metadata = {
  title: "商品目錄",
  description: "瀏覽誠真生活 RealReal 全系列純素健康食品，找到最適合您的天然營養選擇。",
}

const PAGE_SIZE = 24

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string; page?: string; sort?: string }>
}) {
  const { category: rawCategory, q, page, sort } = await searchParams
  // The legacy "all" slug was imported from WooCommerce but holds zero
  // products; treat it as "no filter" so users always see everything.
  const category = rawCategory && rawCategory !== "all" ? rawCategory : undefined
  const currentPage = page ? Number(page) : 1
  const sortOption = (sort as SortOption) || "newest"

  const [categories, { data: products, total }] = await Promise.all([
    getCategories(),
    getProducts({ category, q, page: currentPage, limit: PAGE_SIZE, sort: sortOption }),
  ])

  // Find current category name for section heading
  const currentCategory = categories.find(c => c.slug === category)

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        {/* Page heading */}
        <h1 className="text-3xl md:text-4xl font-bold text-center mb-2 tracking-tight" style={{ color: "#10305a" }}>
          {currentCategory ? currentCategory.name : "所有商品"}
        </h1>
        <p className="text-center mb-10" style={{ color: "#687279" }}>
          共 <span className="font-semibold" style={{ color: "#10305a" }}>{total}</span> 件商品
        </p>

        {/* Horizontal category tabs */}
        <div className="mb-8">
          <Suspense>
            <CategoryFilter categories={categories} layout="horizontal" />
          </Suspense>
        </div>

        {/* Toolbar: sort */}
        <div className="flex items-center justify-end mb-6">
          <Suspense>
            <SortSelect />
          </Suspense>
        </div>

        {/* Product grid */}
        <Suspense fallback={<ProductGridSkeleton />}>
          <ProductGrid products={products} categories={categories} />
        </Suspense>

        {/* Pagination */}
        <div className="mt-12">
          <Suspense>
            <Pagination
              total={total}
              pageSize={PAGE_SIZE}
              currentPage={currentPage}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
