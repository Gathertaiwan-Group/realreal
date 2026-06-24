import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { ChevronRight } from "lucide-react"
import { getProductBySlug, getCategories } from "@/lib/catalog"
import { AddToCartSection } from "@/components/product/AddToCartSection"
import { ImageGallery } from "@/components/product/ImageGallery"

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
          color: "#687279", fontSize: "15px", lineHeight: "1.85", textAlign: "center",
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
  const [product, categories] = await Promise.all([getProductBySlug(slug), getCategories()])
  if (!product) notFound()

  if (!product.is_active) notFound()

  const productCategory = categories.find(c => c.id === product.category_id)
  const isProtein = productCategory?.slug === "plant-based-powder"

  const images = product.images ?? []
  const mainImage = images[0]

  const isHtml = (s: string | null) => (s ?? "").includes("<")

  return (
    <div className="min-h-screen bg-white">
      <style>{`
        .rich-content { font-size: 15px; line-height: 1.85; color: #687279; text-align: center; }
        .rich-content p { margin-bottom: 1rem; }
        .rich-content h2 { font-size: 1.25rem; font-weight: 600; color: #10305a; margin-top: 2rem; margin-bottom: 0.75rem; }
        .rich-content h3 { font-size: 1.1rem; font-weight: 600; color: #10305a; margin-top: 1.75rem; margin-bottom: 0.6rem; }
        .rich-content h4 { font-size: 1rem; font-weight: 600; color: #10305a; margin-top: 1.5rem; margin-bottom: 0.5rem; }
        .rich-content h5 { font-size: 0.95rem; font-weight: 600; color: #10305a; margin-top: 1.25rem; margin-bottom: 0.4rem; }
        .rich-content ul { padding-left: 0; margin: 0.75rem 0; list-style: none; }
        .rich-content ol { padding-left: 0; margin: 0.75rem 0; list-style: none; }
        .rich-content li { margin-bottom: 0.45rem; line-height: 1.75; }
        .rich-content strong, .rich-content b { font-weight: 600; color: #10305a; }
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
          text-align: center;
        }
        .rich-content blockquote h4,
        .rich-content blockquote h5 { margin-top: 0.25rem; }
        .rich-content table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 14px; text-align: center; }
        .rich-content th, .rich-content td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: center; }
        .rich-content th { background: #f3f4f6; font-weight: 600; color: #10305a; }
      `}</style>

      <div className="mx-auto px-4 py-8 max-w-5xl">
        {/* Breadcrumb */}
        <nav className="mb-8 flex items-center gap-1 text-sm" style={{ color: "#687279" }}>
          <Link href="/" className="hover:opacity-70 transition-opacity">首頁</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link href="/shop" className="hover:opacity-70 transition-opacity">商品</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium" style={{ color: "#10305a" }}>{product.name}</span>
        </nav>

        {/* Top: image + purchase info side by side */}
        <div className="grid grid-cols-1 md:grid-cols-[5fr_6fr] gap-8 lg:gap-12 md:items-start">
          <div className="md:sticky md:top-4">
            <ImageGallery images={images} productName={product.name} />
          </div>

          <div className="flex flex-col">
            <h1
              className="text-2xl font-bold tracking-tight lg:text-3xl"
              style={{ color: "#10305a", fontFamily: "'Gill Sans', 'Gill Sans MT', sans-serif" }}
            >
              {product.name}
            </h1>

            <div className="mt-6">
              <AddToCartSection
                productName={product.name}
                variants={product.variants ?? []}
                imageUrl={mainImage ?? undefined}
              />
            </div>

            {/* Excerpt — short intro stays in right column */}
            {product.excerpt && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                {isHtml(product.excerpt)
                  ? <RichContent html={product.excerpt} />
                  : <PlainTextContent text={product.excerpt} />}
              </div>
            )}
          </div>
        </div>

        {/* Description — full width below the grid */}
        {product.description && (
          <div className="mt-10 pt-8 border-t border-gray-100">
            {isHtml(product.description)
              ? <RichContent html={product.description} />
              : <PlainTextContent text={product.description} />}
          </div>
        )}

        {/* 安心保證 image — non-protein products */}
        {!isProtein && (
          <div className="mt-12 flex justify-center">
            <Image
              src="/product-info/assurance.jpg"
              alt="安心保證"
              width={1200}
              height={1200}
              sizes="(max-width: 560px) 100vw, 560px"
              style={{ width: "100%", maxWidth: "560px", height: "auto" }}
              className="rounded-2xl"
            />
          </div>
        )}

        {/* 沖泡說明影片 — protein only */}
        {isProtein && (
          <div className="mt-14 flex flex-col items-center gap-4">
            <h2 className="text-lg font-semibold" style={{ color: "#10305a" }}>沖泡說明</h2>
            <div className="w-full max-w-[360px] overflow-hidden rounded-2xl shadow-md" style={{ aspectRatio: "9/16" }}>
              <iframe
                src="https://www.youtube.com/embed/gkru2H1QJA0"
                title="沖泡說明影片"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          </div>
        )}

        {/* Product info images — protein only */}
        {isProtein && (
          <div className="mt-14 max-w-[960px] mx-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <Image
                key={n}
                src={`/product-info/protein/${n}.jpg`}
                alt={`商品說明 ${n}`}
                width={1800}
                height={2700}
                sizes="(max-width: 960px) 100vw, 960px"
                style={{ width: "100%", height: "auto" }}
                className="block"
              />
            ))}
            {/* Image 10 is 使用者回饋 with 看更多真實回饋 button baked in */}
            <Link href="/testimonials" className="block">
              <Image
                src="/product-info/protein/10.jpg"
                alt="使用者回饋"
                width={1800}
                height={2700}
                sizes="(max-width: 960px) 100vw, 960px"
                style={{ width: "100%", height: "auto" }}
                className="block"
              />
            </Link>
            {/* Image 11 is 安心保證 */}
            <Image
              src="/product-info/protein/11.jpg"
              alt="安心保證"
              width={1800}
              height={2700}
              sizes="(max-width: 960px) 100vw, 960px"
              style={{ width: "100%", height: "auto" }}
              className="block"
            />

            {/* 三個並列按鈕 — protein */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-10 pb-12">
              <Link
                href="/faq"
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 px-8 py-4 text-base font-semibold transition-colors hover:bg-[#10305a] hover:text-white"
                style={{ borderColor: "#10305a", color: "#10305a" }}
              >
                常見問題
              </Link>
              <Link
                href="/about"
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 px-8 py-4 text-base font-semibold transition-colors hover:bg-[#10305a] hover:text-white"
                style={{ borderColor: "#10305a", color: "#10305a" }}
              >
                品牌故事
              </Link>
              <Link
                href="/idea"
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 px-8 py-4 text-base font-semibold transition-colors hover:bg-[#10305a] hover:text-white"
                style={{ borderColor: "#10305a", color: "#10305a" }}
              >
                公益存款
              </Link>
            </div>
          </div>
        )}

        {/* 品牌故事 + 公益存款 — non-protein products */}
        {!isProtein && (
          <div className="mt-10 mb-4 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/about"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 px-8 py-4 text-base font-semibold transition-colors hover:bg-[#10305a] hover:text-white"
              style={{ borderColor: "#10305a", color: "#10305a" }}
            >
              品牌故事
            </Link>
            <Link
              href="/idea"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 px-8 py-4 text-base font-semibold transition-colors hover:bg-[#10305a] hover:text-white"
              style={{ borderColor: "#10305a", color: "#10305a" }}
            >
              公益存款
            </Link>
          </div>
        )}

      </div>
    </div>
  )
}
