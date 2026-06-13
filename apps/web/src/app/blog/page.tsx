import Link from "next/link"
import Image from "next/image"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getPosts } from "@/lib/content"
import type { Post } from "@/lib/content"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "聰明生活 | 誠真生活 RealReal",
  description:
    "探索純素生活、植物營養、健康飲食的最新知識與靈感，由誠真生活為你精選。",
  openGraph: {
    title: "聰明生活 — 誠真生活 RealReal",
    description: "探索純素生活、植物營養、健康飲食的最新知識與靈感。",
    type: "website",
  },
}

const POSTS_PER_PAGE = 9

function formatDate(dateStr: string | null) {
  if (!dateStr) return ""
  const d = new Date(dateStr)
  return d.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function PostCard({ post }: { post: Post }) {
  return (
    <Link href={`/blog/${post.slug}`} className="group">
      <Card className="overflow-hidden border-0 shadow-sm hover:shadow-lg transition-shadow duration-300 h-full">
        <div className="aspect-[16/9] relative bg-gradient-to-br from-[#f5f0fa] to-[#faf6f2] overflow-hidden">
          {post.cover_image ? (
            <Image
              src={post.cover_image}
              alt={post.title}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className={`object-cover transition-transform duration-500 group-hover:scale-105 ${
                post.category === "真實見證" ? "object-top" : ""
              }`}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[#10305a]/20 text-5xl">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                <path d="M18 14h-8" />
                <path d="M15 18h-5" />
                <path d="M10 6h8v4h-8V6Z" />
              </svg>
            </div>
          )}
          {post.category && (
            <span className="absolute top-3 left-3 rounded-full bg-[#10305a] px-3 py-1 text-xs font-medium text-white">
              {post.category}
            </span>
          )}
        </div>
        <CardContent className="p-5">
          <h3 className="font-semibold text-[#10305a] line-clamp-2 group-hover:underline">
            {post.title}
          </h3>
          {post.excerpt && (
            <p className="mt-2 text-sm text-[#687279] line-clamp-2">
              {post.excerpt}
            </p>
          )}
          <p className="mt-3 text-xs text-[#687279]/70">
            {formatDate(post.published_at)}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>
}) {
  const params = await searchParams
  const currentPage = Number(params.page) || 1
  const currentCategory = params.category || undefined

  const { data: posts, total } = await getPosts({
    page: currentPage,
    limit: POSTS_PER_PAGE,
    category: currentCategory,
  })

  const totalPages = Math.ceil(total / POSTS_PER_PAGE)

  // Collect unique categories from posts for filter tabs
  const categories = Array.from(
    new Set(posts.map((p) => p.category).filter(Boolean))
  ) as string[]

  return (
    <div className="min-h-screen">
      {/* Header */}
      <section
        className="relative py-24 bg-cover bg-center"
        style={{ backgroundImage: "url('/blog/banner.jpg')" }}
      >
        <div className="absolute inset-0 bg-white/40" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-[#10305a] sm:text-4xl">
            聰明生活
          </h1>
          <p className="mt-4 text-[#687279] text-lg max-w-2xl mx-auto">
            從飲食到日常，陪你活得更清醒、更自在
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Category filter tabs */}
        {categories.length > 0 && (
          <div className="mb-10 flex flex-wrap items-center gap-2">
            <Link
              href="/blog"
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                !currentCategory
                  ? "bg-[#10305a] text-white"
                  : "bg-[#fffeee] text-[#10305a] hover:bg-[#10305a]/10"
              }`}
            >
              全部
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat}
                href={`/blog?category=${encodeURIComponent(cat)}`}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  currentCategory === cat
                    ? "bg-[#10305a] text-white"
                    : "bg-[#fffeee] text-[#10305a] hover:bg-[#10305a]/10"
                }`}
              >
                {cat}
              </Link>
            ))}
          </div>
        )}

        {/* Posts grid */}
        {posts.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-lg text-[#687279]">目前還沒有文章，敬請期待。</p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="mt-12 flex items-center justify-center gap-2">
            {currentPage > 1 && (
              <Button
                asChild
                variant="outline"
                className="rounded-[10px] border-[#10305a]/30 text-[#10305a]"
              >
                <Link
                  href={`/blog?page=${currentPage - 1}${currentCategory ? `&category=${currentCategory}` : ""}`}
                >
                  上一頁
                </Link>
              </Button>
            )}

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
              <Button
                key={pg}
                asChild
                variant={pg === currentPage ? "default" : "outline"}
                size="icon"
                className={
                  pg === currentPage
                    ? "rounded-[10px] bg-[#10305a] text-white"
                    : "rounded-[10px] border-[#10305a]/30 text-[#10305a]"
                }
              >
                <Link
                  href={`/blog?page=${pg}${currentCategory ? `&category=${currentCategory}` : ""}`}
                >
                  {pg}
                </Link>
              </Button>
            ))}

            {currentPage < totalPages && (
              <Button
                asChild
                variant="outline"
                className="rounded-[10px] border-[#10305a]/30 text-[#10305a]"
              >
                <Link
                  href={`/blog?page=${currentPage + 1}${currentCategory ? `&category=${currentCategory}` : ""}`}
                >
                  下一頁
                </Link>
              </Button>
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
