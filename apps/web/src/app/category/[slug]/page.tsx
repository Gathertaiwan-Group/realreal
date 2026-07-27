import { notFound } from "next/navigation"
import { CategoryHero } from "@/components/category/CategoryHero"
import { BannerCarousel } from "@/components/catalog/BannerCarousel"
import { FeatureBlocks, type FeatureBlock } from "@/components/category/FeatureBlocks"
import { RelatedPosts, type RelatedPost } from "@/components/category/RelatedPosts"
import { ProductGrid } from "@/components/catalog/ProductGrid"
import { getProducts, getCategories } from "@/lib/catalog"

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
      "一杯喝得到誠意與初心的植物蛋白粉。\n滋養身心，也滋養生活。",
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

// 植物蛋白粉分類頁的商品分組 — 風味軸（純粹／果實）+ 使用情境軸（穩定補給／多日體驗）。
// 穩定補給／入門推薦 是既有商品名稱前綴，直接對應「組合包」；其餘單一口味商品
// 依風味關鍵字分類。四組彼此互斥、涵蓋所有現行商品，無需另外標記資料庫欄位。
type ProteinSeries = "pure" | "fruit" | "steady" | "trial"

function classifyProteinProduct(name: string): ProteinSeries {
  if (name.startsWith("穩定補給")) return "steady"
  if (name.startsWith("入門推薦")) return "trial"
  if (name.includes("原味") || name.includes("可可")) return "pure"
  return "fruit"
}

const PROTEIN_SERIES_META: Record<ProteinSeries, { title: string; subtitle: string }> = {
  pure: { title: "純粹系列", subtitle: "原味、可可——簡單純粹的日常之選" },
  fruit: { title: "果實系列", subtitle: "草莓、杏仁火龍果、芝麻藍莓——真實水果的自然風味" },
  steady: { title: "穩定補給", subtitle: "日常持續補充的完整組合" },
  trial: { title: "多日體驗", subtitle: "初次嘗試的天數體驗組合" },
}
const PROTEIN_SERIES_ORDER: ProteinSeries[] = ["pure", "fruit", "steady", "trial"]

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

type CategoryLanding = {
  id: string
  name: string
  slug: string
  banner_url?: string | null
  tagline?: string | null
  subtitle?: string | null
  feature_blocks?: FeatureBlock[] | null
  related_post_slugs?: string[] | null
}

type CategoryResponse = {
  category: CategoryLanding
  posts: RelatedPost[]
}

async function getCategoryLanding(slug: string): Promise<CategoryResponse | null> {
  const res = await fetch(`${API_URL}/categories/${slug}`, {
    next: { revalidate: 60 },
  })
  if (res.status === 404) return null
  if (!res.ok) return null
  return res.json()
}

export default async function CategoryLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const landing = await getCategoryLanding(slug)
  if (!landing) notFound()

  const { category, posts } = landing

  const isProtein = slug === "plant-based-powder"
  const isFruit = slug === "freeze-dried"

  const [{ data: products }, categories] = await Promise.all([
    getProducts({ category: slug, limit: 24, sort: "price_desc" }),
    getCategories(),
  ])

  const blocks = category.feature_blocks ?? []
  const tagline = category.tagline ?? category.name

  return (
    <div className="min-h-screen bg-white">
      {isProtein ? (
        <BannerCarousel slides={PROTEIN_SLIDES} />
      ) : isFruit ? (
        <BannerCarousel slides={FRUIT_SLIDES} />
      ) : (
        <CategoryHero
          bannerUrl={category.banner_url}
          tagline={tagline}
          subtitle={category.subtitle}
          objectPosition={slug === "sustain-life" ? "50% 60%" : "center"}
        />
      )}

      {!isFruit && blocks.length > 0 && <FeatureBlocks blocks={blocks} />}

      <section className="mx-auto max-w-7xl px-4 py-12">
        {isProtein ? (
          <>
            {PROTEIN_SERIES_ORDER.map((series) => {
              const group = (products ?? []).filter(
                (p) => classifyProteinProduct(p.name) === series
              )
              if (group.length === 0) return null
              const meta = PROTEIN_SERIES_META[series]
              return (
                <div key={series} className="mb-14 last:mb-0">
                  <h2
                    className="text-2xl md:text-3xl font-semibold"
                    style={{ color: "#10305a" }}
                  >
                    {meta.title}
                  </h2>
                  <p className="text-sm md:text-base text-zinc-500 mt-1 mb-6">
                    {meta.subtitle}
                  </p>
                  <ProductGrid products={group} categories={categories} />
                </div>
              )
            })}
          </>
        ) : (
          <>
            <h2
              className="text-2xl md:text-3xl font-semibold mb-8"
              style={{ color: "#10305a" }}
            >
              {category.name}
            </h2>
            <ProductGrid products={products ?? []} categories={categories} />
          </>
        )}
      </section>

      {posts && posts.length > 0 && (
        <RelatedPosts heading="大家都在看" posts={posts} />
      )}
    </div>
  )
}
