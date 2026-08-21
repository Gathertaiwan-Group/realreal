import { notFound } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { ChevronRight } from "lucide-react"
import { getProductBySlug, getCategories } from "@/lib/catalog"
import { AddToCartSection } from "@/components/product/AddToCartSection"
import { Badge } from "@/components/ui/badge"
import { ImageGallery } from "@/components/product/ImageGallery"
import { createClient } from "@/lib/supabase/server"

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
  const isFruit = productCategory?.slug === "freeze-dried"

  // Membership tier gate — compute server-side so the locked state is in the HTML
  let minTierName: string | undefined
  let userQualifies = true
  if (product.min_tier) {
    minTierName = product.min_tier.name
    userQualifies = false
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("membership_tier_id")
          .eq("user_id", user.id)
          .maybeSingle()
        const userTierId = (profile as { membership_tier_id: string | null } | null)?.membership_tier_id ?? null
        if (userTierId) {
          const { data: userTier } = await supabase
            .from("membership_tiers")
            .select("min_spend")
            .eq("id", userTierId)
            .maybeSingle()
          if (userTier) {
            userQualifies = Number((userTier as { min_spend: number }).min_spend) >= Number(product.min_tier.min_spend)
          }
        }
      }
    } catch {
      userQualifies = false
    }
  }

  const images = product.images ?? []
  const mainImage = images[0]

  const isHtml = (s: string | null) => (s ?? "").includes("<")

  // Some products author a variant-selection hint (e.g. "選擇其他口味請於
  // 結帳頁面備註") as the excerpt's first paragraph so it can live in the
  // DB alongside the rest of the excerpt content. Pull that specific line
  // out to render next to the variant buttons instead of down with the
  // rest of the excerpt.
  const VARIANT_NOTE_TEXT = "選擇其他口味請於結帳頁面備註"
  const variantNotePrefix = `<p>${VARIANT_NOTE_TEXT}</p>`
  let variantNote: string | undefined
  let displayExcerpt = product.excerpt
  if (product.excerpt?.startsWith(variantNotePrefix)) {
    variantNote = VARIANT_NOTE_TEXT
    displayExcerpt = product.excerpt.slice(variantNotePrefix.length).replace(/^\n+/, "")
  }

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
            {product.badge_text && (
              <Badge className="mb-2 w-fit" style={{ backgroundColor: "#F4617A" }}>
                {product.badge_text}
              </Badge>
            )}
            {minTierName && (
              <Badge className="mb-2 w-fit" style={{ backgroundColor: "#10305a" }}>
                {minTierName}限定
              </Badge>
            )}
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
                minTierName={minTierName}
                userQualifies={userQualifies}
                variantNote={variantNote}
              />
            </div>

            {/* Excerpt — short intro stays in right column */}
            {displayExcerpt && (
              <div className="mt-6 pt-6 border-t border-gray-100">
                {isHtml(displayExcerpt)
                  ? <RichContent html={displayExcerpt} />
                  : <PlainTextContent text={displayExcerpt} />}
              </div>
            )}
          </div>
        </div>

        {/* Description — full width below the grid (hidden for fruit products) */}
        {product.description && !isFruit && (
          <div className="mt-10 pt-8 border-t border-gray-100">
            {isHtml(product.description)
              ? <RichContent html={product.description} />
              : <PlainTextContent text={product.description} />}
          </div>
        )}

        {/* 凍乾水果商說圖 — fruit products only */}
        {isFruit && (
          <div className="mt-14 max-w-[960px] mx-auto">
            {["1", "2", "3-v2", "4-v2", "5-v3"].map((n) => (
              <Image
                key={n}
                src={`/product-info/fruit/${n}.png`}
                alt={`凍乾水果商品說明 ${n}`}
                width={1800}
                height={1350}
                sizes="(max-width: 960px) 100vw, 960px"
                style={{ width: "100%", height: "auto" }}
                className="block"
                unoptimized
              />
            ))}
          </div>
        )}

        {/* 安心保證 image — non-protein, non-fruit products only (bags skipped: use 公益存款 image inline in description) */}
        {!isProtein && !isFruit && product.slug !== "bag1" && product.slug !== "canvabag_s" && (
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

        {/* Product info images — protein only. Slot 7 is the nutrition-facts
            sheet: 300克/夾鏈袋 products (single 300克 bags, and the 3/10-入
            bundles built from those bags) show the 6-serving sheet; every
            other protein product — the standalone 50克 packs AND the
            50克-pack bundles (一週任務包, 10/30/60天 組合) — is built from
            1-serving packs, so it shows the 1-serving sheet. */}
        {isProtein && (
          <div className="mt-14 max-w-[960px] mx-auto">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
              const is6Serving = product.name.includes("300克") || product.name.includes("夾鏈袋")
              const src =
                n === 7 && !is6Serving
                  ? "/product-info/protein/7-single.jpg"
                  : `/product-info/protein/${n}.jpg`
              return (
                <Image
                  key={n}
                  src={src}
                  alt={`商品說明 ${n}`}
                  width={1800}
                  height={2700}
                  sizes="(max-width: 960px) 100vw, 960px"
                  style={{ width: "100%", height: "auto" }}
                  className="block"
                  unoptimized
                />
              )
            })}
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
                unoptimized
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
              unoptimized
            />

            {/* 三個並列按鈕 — protein */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-10 pb-12">
              <Link
                href="/faq"
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 border-[#10305a] bg-white px-8 py-4 text-base font-semibold text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white"
              >
                常見問題
              </Link>
              <Link
                href="/about"
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 border-[#10305a] bg-white px-8 py-4 text-base font-semibold text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white"
              >
                品牌故事
              </Link>
              <Link
                href="/idea"
                className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 border-[#10305a] bg-white px-8 py-4 text-base font-semibold text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white"
              >
                公益存款
              </Link>
            </div>
          </div>
        )}

        {/* 常見問題 + 品牌故事 + 公益存款 — non-protein products */}
        {!isProtein && (
          <div className="mt-10 mb-4 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/faq"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 border-[#10305a] bg-white px-8 py-4 text-base font-semibold text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white"
            >
              常見問題
            </Link>
            <Link
              href="/about"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 border-[#10305a] bg-white px-8 py-4 text-base font-semibold text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white"
            >
              品牌故事
            </Link>
            <Link
              href="/idea"
              className="flex-1 sm:flex-none inline-flex items-center justify-center rounded-full border-2 border-[#10305a] bg-white px-8 py-4 text-base font-semibold text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white"
            >
              公益存款
            </Link>
          </div>
        )}

      </div>
    </div>
  )
}
