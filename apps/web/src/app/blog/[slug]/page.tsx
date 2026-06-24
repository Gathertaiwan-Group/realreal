import Link from "next/link"
import { notFound } from "next/navigation"
import { getPostBySlug } from "@/lib/content"
import type { Metadata } from "next"

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPostBySlug(slug)

  if (!post) {
    return { title: "找不到文章 | 誠真生活 RealReal" }
  }

  return {
    title: `${post.seo_title || post.title} | 誠真生活 RealReal`,
    description: post.seo_description || post.excerpt || undefined,
    openGraph: {
      title: post.seo_title || post.title,
      description: post.seo_description || post.excerpt || undefined,
      type: "article",
      ...(post.cover_image ? { images: [post.cover_image] } : {}),
    },
  }
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

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = await getPostBySlug(slug)

  if (!post) notFound()

  return (
    <article className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Breadcrumb */}
        <nav className="mb-8 text-sm text-[#687279]">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-[#10305a] transition-colors">
                首頁
              </Link>
            </li>
            <li>/</li>
            <li>
              <Link
                href="/blog"
                className="hover:text-[#10305a] transition-colors"
              >
                聰明生活
              </Link>
            </li>
            <li>/</li>
            <li className="text-[#10305a] font-medium line-clamp-1">
              {post.title}
            </li>
          </ol>
        </nav>

        {/* Meta */}
        <header className="mb-10">
          {post.category && (
            <span className="inline-block rounded-full bg-[#10305a] px-3 py-1 text-xs font-medium text-white mb-4">
              {post.category}
            </span>
          )}
          <h1 className="text-2xl font-bold leading-tight text-[#10305a] sm:text-3xl lg:text-4xl">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[#687279]">
            {post.author && <span>{post.author}</span>}
            {post.author && post.published_at && (
              <span className="text-[#687279]/40">|</span>
            )}
            {post.published_at && <time>{formatDate(post.published_at)}</time>}
          </div>
        </header>

        {/* Content */}
        {post.content_html ? (
          <div
            className="prose prose-zinc max-w-none
              prose-headings:text-[#10305a] prose-headings:font-bold
              prose-p:text-[#687279] prose-p:leading-relaxed
              prose-a:text-[#10305a] prose-a:underline
              prose-img:rounded-[10px]
              prose-li:text-[#687279]
              prose-blockquote:border-[#10305a]/30 prose-blockquote:text-[#687279]
              prose-strong:text-[#10305a]
              [&_p:empty]:min-h-[1.5em] [&_p:empty]:block
              [&_p:has(>br:only-child)]:min-h-[1.5em]"
            dangerouslySetInnerHTML={{ __html: post.content_html }}
          />
        ) : (
          <p className="text-[#687279]">文章內容即將上線。</p>
        )}

        {/* Back link */}
        <div className="mt-16 border-t pt-8">
          <Link
            href={post.category === "真實見證" ? "/testimonials" : "/blog"}
            className="inline-flex items-center gap-2 text-sm font-medium text-[#10305a] hover:underline"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            {post.category === "真實見證" ? "返回真實見證" : "返回聰明生活"}
          </Link>
        </div>
      </div>
    </article>
  )
}
