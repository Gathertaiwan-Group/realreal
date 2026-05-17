import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { getProductBySlug } from "@/lib/catalog"
import { AddToCartSection } from "@/components/product/AddToCartSection"
import { ImageGallery } from "@/components/product/ImageGallery"
import { ReviewForm } from "@/components/product/ReviewForm"
import { createClient } from "@/lib/supabase/server"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

type Review = {
  id: string
  rating: number
  content: string
  author_name: string
  created_at: string
}

function displayName(name: string) {
  return name || "匿名"
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} style={{ color: star <= rating ? "#f59e0b" : "#d1d5db" }}>
          &#9733;
        </span>
      ))}
    </span>
  )
}

const BULLET_CHARS = "✔✅✓▪▸•◆■◉"
const BULLET_START_RE = new RegExp(`^[${BULLET_CHARS}]`)
// Split "✔ A ✔ B" → ["✔ A", "✔ B"] by splitting on space-before-bullet
const INLINE_SPLIT_RE = new RegExp(` (?=[${BULLET_CHARS}])`)

/** Split plain-text into paragraphs. Handles blank-line, per-line bullets, and inline bullets. */
/** Render a text segment with bare URLs converted to clickable <a> tags */
const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g
const URL_TEST_RE = /^https?:\/\//
function renderWithLinks(text: string) {
  const parts = text.split(URL_SPLIT_RE)
  return parts.map((part, i) =>
    URL_TEST_RE.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer"
           style={{ color: "#10305a", textDecoration: "underline", textUnderlineOffset: "2px", wordBreak: "break-all" }}>
          {part}
        </a>
      : part
  )
}

function PlainTextContent({ text }: { text: string }) {
  const normalized = text.replace(/\r\n/g, "\n").trim()
  const lines = normalized.split("\n").map(l => l.trim()).filter(Boolean)

  let paragraphs: string[]

  if (lines.length === 1) {
    // Single line — split on space-before-bullet ("✔ A ✔ B ✔ C")
    const parts = lines[0].split(INLINE_SPLIT_RE).map(s => s.trim()).filter(Boolean)
    paragraphs = parts.length > 1 ? parts : lines
  } else {
    const bulletCount = lines.filter(l => BULLET_START_RE.test(l)).length
    paragraphs = bulletCount >= lines.length * 0.5
      ? lines
      : normalized.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  }

  return (
    <div>
      {paragraphs.map((para, i) => (
        <p key={i} style={{
          color: "#687279", fontSize: "15px", lineHeight: "1.85",
          marginBottom: i < paragraphs.length - 1 ? "0.75rem" : 0,
        }}>
          {para.split("\n").map((line, j, arr) => (
            <span key={j}>{renderWithLinks(line)}{j < arr.length - 1 && <br />}</span>
          ))}
        </p>
      ))}
    </div>
  )
}

/**
 * Auto-link bare URLs inside an HTML string.
 * Negative lookbehind (?<!['"=]) skips URLs already inside href/src attributes.
 */
function autoLinkHtml(html: string): string {
  return html.replace(
    /(?<!['">=])(https?:\/\/[^\s<>"&]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#10305a;text-decoration:underline;text-underline-offset:2px;word-break:break-all">$1</a>'
  )
}

/** Rich HTML from WordPress — styled via prose + custom CSS variables */
function RichContent({ html }: { html: string }) {
  return (
    <div
      className="rich-content"
      style={{ color: "#687279" }}
      dangerouslySetInnerHTML={{ __html: autoLinkHtml(html) }}
    />
  )
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return { title: "商品不存在" }
  return { title: `${product.name} | 誠真生活 RealReal`, description: product.description }
}

export default async function ProductDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) notFound()

  const images = product.images ?? []
  const mainImage = images[0]

  let reviews: Review[] = []
  let averageRating = 0
  let totalCount = 0
  try {
    const reviewsRes = await fetch(`${API_URL}/products/${product.id}/reviews`, { next: { revalidate: 60 } })
    if (reviewsRes.ok) {
      const json = await reviewsRes.json()
      reviews = json.data ?? []
      averageRating = json.averageRating ?? 0
      totalCount = json.totalCount ?? 0
    }
  } catch { /* API unavailable */ }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token ?? ""

  const hasShopColumns = product.shop_left || product.shop_middle || product.shop_right
  const isHtml = (s: string | null) => (s ?? "").includes("<")

  return (
    <div className="min-h-screen bg-white">
      <style>{`
        .rich-content { font-size: 15px; line-height: 1.85; color: #687279; }
        .rich-content p { margin-bottom: 1rem; }
        .rich-content h2 { font-size: 1.25rem; font-weight: 600; color: #10305a; margin-top: 2rem; margin-bottom: 0.75rem; }
        .rich-content h3 { font-size: 1.1rem; font-weight: 600; color: #10305a; margin-top: 1.75rem; margin-bottom: 0.6rem; }
        .rich-content h4 { font-size: 1rem; font-weight: 600; color: #10305a; margin-top: 1.5rem; margin-bottom: 0.5rem; }
        .rich-content h5 { font-size: 0.95rem; font-weight: 600; color: #10305a; margin-top: 1.25rem; margin-bottom: 0.4rem; }
        .rich-content ul { padding-left: 1.25rem; margin: 0.75rem 0; list-style-type: disc; }
        .rich-content ol { padding-left: 1.25rem; margin: 0.75rem 0; list-style-type: decimal; }
        .rich-content li { margin-bottom: 0.45rem; line-height: 1.75; }
        .rich-content strong, .rich-content b { font-weight: 600; color: #10305a; }
        /* ✔ bullet items: <strong>✔ title</strong> as direct children become block-level */
        .rich-content > strong, .rich-content > b { display: block; margin-top: 1.1rem; margin-bottom: 0.2rem; }
        .rich-content em, .rich-content i { font-style: italic; }
        .rich-content a { color: #10305a; text-decoration: underline; text-underline-offset: 2px; }
        .rich-content blockquote {
          border-left: 4px solid rgba(16,48,90,0.25);
          background: #f9fafb;
          padding: 1rem 1.25rem;
          border-radius: 0 0.75rem 0.75rem 0;
          margin: 1.25rem 0;
          font-style: normal;
        }
        .rich-content blockquote h4,
        .rich-content blockquote h5 { margin-top: 0.25rem; }
        .rich-content table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 14px; }
        .rich-content th, .rich-content td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: left; }
        .rich-content th { background: #f3f4f6; font-weight: 600; color: #10305a; }
      `}</style>

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Breadcrumb */}
        <nav className="mb-8 flex items-center gap-1 text-sm" style={{ color: "#687279" }}>
          <Link href="/" className="hover:opacity-70 transition-opacity">首頁</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link href="/shop" className="hover:opacity-70 transition-opacity">商品</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium" style={{ color: "#10305a" }}>{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
          <ImageGallery images={images} productName={product.name} />

          <div className="flex flex-col">
            <h1
              className="text-2xl font-bold tracking-tight lg:text-3xl"
              style={{ color: "#10305a", fontFamily: "'Gill Sans', 'Gill Sans MT', sans-serif" }}
            >
              {product.name}
            </h1>

            {/* Stars */}
            <div className="mt-3 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(star => (
                <span key={star} className="text-lg"
                  style={{ color: star <= Math.round(averageRating) ? "#f59e0b" : "#d1d5db" }}>
                  &#9733;
                </span>
              ))}
              <span className="ml-2 text-sm" style={{ color: "#687279" }}>
                ({totalCount > 0 ? averageRating.toFixed(1) : "尚無評價"})
              </span>
            </div>

            <div className="mt-6">
              <AddToCartSection
                productName={product.name}
                variants={product.variants ?? []}
                imageUrl={mainImage ?? undefined}
              />
            </div>

            {/* Excerpt */}
            {product.excerpt && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                {isHtml(product.excerpt)
                  ? <RichContent html={product.excerpt} />
                  : <PlainTextContent text={product.excerpt} />}
              </div>
            )}

            {/* Description — only when no 3-column content */}
            {product.description && !hasShopColumns && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                {isHtml(product.description)
                  ? <RichContent html={product.description} />
                  : <PlainTextContent text={product.description} />}
              </div>
            )}
          </div>
        </div>

        {/* Product info images (shared 6–14, full-width vertical stack) */}
        <div className="mt-14">
          {[6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => (
            <img
              key={n}
              src={`/product-info/${n}.jpg`}
              alt={`商品說明 ${n}`}
              loading="lazy"
              className="w-full block"
            />
          ))}
        </div>

        {/* Reviews */}
        <div className="mt-14 border-t border-gray-200 pt-10">
          <h2 className="text-xl font-bold mb-2" style={{ color: "#10305a" }}>商品評價</h2>
          <div className="flex items-center gap-3 mb-6">
            <span className="text-3xl font-bold" style={{ color: "#10305a" }}>
              {totalCount > 0 ? averageRating.toFixed(1) : "-"}
            </span>
            <div>
              <StarRating rating={Math.round(averageRating)} />
              <p className="text-sm" style={{ color: "#687279" }}>
                {totalCount > 0 ? `${totalCount} 則評價` : "尚無評價"}
              </p>
            </div>
          </div>

          {user && token && (
            <div className="mb-8">
              <ReviewForm productId={product.id} token={token} />
            </div>
          )}

          <div className="space-y-4">
            {reviews.map(review => (
              <div key={review.id} className="rounded-[10px] border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: "#10305a" }}>
                      {displayName(review.author_name)}
                    </span>
                    <StarRating rating={review.rating} />
                  </div>
                  <span className="text-xs" style={{ color: "#687279" }}>
                    {new Date(review.created_at).toLocaleDateString("zh-TW")}
                  </span>
                </div>
                <p style={{ fontSize: "15px", lineHeight: "1.8", color: "#687279", marginTop: "0.5rem" }}>
                  {review.content}
                </p>
              </div>
            ))}
          </div>

          {reviews.length === 0 && !user && (
            <p className="text-sm text-center py-8" style={{ color: "#687279" }}>此商品尚無評價</p>
          )}
        </div>
      </div>
    </div>
  )
}
