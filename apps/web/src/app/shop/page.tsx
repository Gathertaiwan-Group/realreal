import { Suspense } from "react"
import { getCategories, getProducts } from "@/lib/catalog"
import type { SortOption } from "@/lib/catalog"
import { ProductGrid, ProductGridSkeleton } from "@/components/catalog/ProductGrid"
import { CategoryFilter } from "@/components/catalog/CategoryFilter"
import { SortSelect } from "@/components/catalog/SortSelect"
import { Pagination } from "@/components/catalog/Pagination"
import { BannerCarousel } from "@/components/catalog/BannerCarousel"

const FRUIT_SLIDES = [
  {
    src: "/shop/fruit-banners/bg.jpg",
    alt: "凍乾水果",
    title: "為你的笑容，鎖住每一口純粹",
    body: [
      "孩子的笑容，是世界上最純粹的能量。",
      "每一顆凍乾水果，都是對這份純粹的承諾。",
    ],
  },
  {
    src: "/shop/fruit-banners/bg.jpg",
    alt: "凍乾水果",
    title: "先進凍乾技術，完整鎖住營養",
    body: [
      "完整保留維生素、膳食纖維與微量元素。\n無化學添加劑，孩子吃得健康，大人放心。",
    ],
  },
  {
    src: "/shop/fruit-banners/bg.jpg",
    alt: "凍乾水果",
    title: "全年齡皆宜的快樂零食",
    body: [
      "早餐配料、下午茶點心、隨身零食或戶外探險食糧",
      "真正的美味不只是味蕾的享受，更是大家共享的幸福感。",
    ],
  },
]

const PROTEIN_SLIDES = [
  {
    src: "/shop/protein-banners/3.jpg",
    alt: "植物蛋白粉 可可",
    title: "誠真生活植物蛋白粉",
    body: [
      "從古早味杏仁茶出發的未來營養學",
      "一杯喝得到誠意與初心的高蛋白。\n滋養身心，也滋養生活。",
    ],
  },
  {
    src: "/shop/protein-banners/5.jpg",
    alt: "植物蛋白粉 黑芝麻",
    title: "營養可以誠實，風味可以真實",
    body: [
      "以大豆、豌豆、米蛋白為基底，\n結合真實凍乾水果，保留纖維與自然香氣。\n無香料、無添加糖，只保留食物本身的原味。",
    ],
  },
  {
    src: "/shop/protein-banners/4.jpg",
    alt: "植物蛋白粉 草莓",
    title: "從街角的杏仁香，到未來的營養學",
    body: [
      "我們邀請深耕三十餘年的杏仁茶堅果穀粉專家，\n以植物為本、以真實食材為魂，\n將傳統的溫潤滋味，化為現代的營養力。",
      "每一口，都喝得到真實的凍乾水果——\n沒有多餘修飾，只有食物的本味與濃厚的誠意。",
      "一份來自台灣的實在創新\n為每一個年齡的身與心，注入溫潤又堅定的力量。",
    ],
  },
]

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
  const sortOption = (sort as SortOption) || "price_desc"

  const [categories, { data: products, total }] = await Promise.all([
    getCategories(),
    getProducts({ category, q, page: currentPage, limit: PAGE_SIZE, sort: sortOption }),
  ])
  // NOTE: products is rendered in API order (is_featured DESC, display_priority DESC,
  // created_at DESC by default; or the sort option chosen by the user). DO NOT add a
  // client-side .sort() here — it would override the server's intended ordering and
  // break the featured/priority controls. See spec B section 5.

  // Find current category name for section heading
  const currentCategory = categories.find(c => c.slug === category)
  const isProteinCategory = currentCategory?.slug === "plant-based-powder"
  const isFruitCategory = currentCategory?.slug === "freeze-dried"

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-7xl">
        {/* Category banner carousels */}
        {isProteinCategory && (
          <BannerCarousel slides={PROTEIN_SLIDES} />
        )}
        {isFruitCategory && (
          <BannerCarousel slides={FRUIT_SLIDES} />
        )}

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
