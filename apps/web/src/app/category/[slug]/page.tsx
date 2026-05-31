import { notFound } from "next/navigation"
import { CategoryHero } from "@/components/category/CategoryHero"
import { FeatureBlocks, type FeatureBlock } from "@/components/category/FeatureBlocks"
import { RelatedPosts, type RelatedPost } from "@/components/category/RelatedPosts"
import { ProductGrid } from "@/components/catalog/ProductGrid"
import { getProducts, getCategories } from "@/lib/catalog"

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

  const [{ data: products }, categories] = await Promise.all([
    getProducts({ category: slug, limit: 24 }),
    getCategories(),
  ])

  const blocks = category.feature_blocks ?? []
  const tagline = category.tagline ?? category.name

  return (
    <div className="min-h-screen bg-white">
      <CategoryHero
        bannerUrl={category.banner_url}
        tagline={tagline}
        subtitle={category.subtitle}
      />

      {blocks.length > 0 && <FeatureBlocks blocks={blocks} />}

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
