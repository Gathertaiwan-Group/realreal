import { notFound } from "next/navigation"
import { CategoryHero } from "@/components/category/CategoryHero"
import { BannerCarousel } from "@/components/catalog/BannerCarousel"
import { ExplainCarousel } from "@/components/catalog/ExplainCarousel"

const PROTEIN_EXPLAIN = Array.from({ length: 11 }, (_, i) => ({
  src: `/shop/protein-explain/${i + 1}.jpg`,
  alt: `植物蛋白粉說明 ${i + 1}`,
}))
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
        <>
          <BannerCarousel slides={PROTEIN_SLIDES} />
          <ExplainCarousel images={PROTEIN_EXPLAIN} />
        </>
      ) : isFruit ? (
        <BannerCarousel slides={FRUIT_SLIDES} />
      ) : (
        <CategoryHero
          bannerUrl={category.banner_url}
          tagline={tagline}
          subtitle={category.subtitle}
        />
      )}

      {!isFruit && blocks.length > 0 && <FeatureBlocks blocks={blocks} />}

      <section className="mx-auto max-w-7xl px-4 py-12">
        <h2
          className="text-2xl md:text-3xl font-semibold mb-8"
          style={{ color: "#10305a" }}
        >
          {category.name}
        </h2>
        <ProductGrid products={products ?? []} categories={categories} />
      </section>

      {posts && posts.length > 0 && (
        <RelatedPosts heading="大家都在看" posts={posts} />
      )}
    </div>
  )
}
