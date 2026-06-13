import Link from "next/link"
import Image from "next/image"
import { Card, CardContent } from "@/components/ui/card"
import { getPosts } from "@/lib/content"
import type { Post } from "@/lib/content"
import type { Metadata } from "next"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "真實見證 | 誠真生活 RealReal",
  description:
    "來自不同生活背景的真實分享——從研究生到職業媽媽，聽聽他們怎麼說誠真生活植物蛋白。",
  openGraph: {
    title: "真實見證 — 誠真生活 RealReal",
    description: "來自不同生活背景的真實分享，聽聽他們怎麼說。",
    type: "website",
  },
}

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
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[#10305a]/20 text-5xl">
              💬
            </div>
          )}
        </div>
        <CardContent className="p-5">
          <h2 className="font-semibold text-[#10305a] line-clamp-2 group-hover:underline">
            {post.title}
          </h2>
          {post.excerpt && (
            <p className="mt-2 text-sm text-[#687279] line-clamp-2">{post.excerpt}</p>
          )}
          {post.published_at && (
            <p className="mt-3 text-xs text-zinc-400">{formatDate(post.published_at)}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

export default async function TestimonialsPage() {
  const { data: posts } = await getPosts({ category: "真實見證", limit: 20 })

  return (
    <div className="min-h-screen">
      {/* Banner */}
      <section
        className="relative py-24 bg-cover bg-center"
        style={{ backgroundImage: "url('/blog/banner.jpg')" }}
      >
        <div className="absolute inset-0 bg-white/40" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-[#10305a] sm:text-4xl">
            真實見證
          </h1>
          <p className="mt-4 text-[#687279] text-lg max-w-2xl mx-auto">
            來自不同生活背景的真實分享，聽聽他們怎麼說。
          </p>
        </div>
      </section>

      {/* Posts grid */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {posts.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-lg text-[#687279]">見證文章即將上線，敬請期待。</p>
          </div>
        )}
      </div>
    </div>
  )
}
