import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getProducts } from "@/lib/catalog"
import type { Product } from "@/lib/catalog"
import { getSiteContent, getPosts } from "@/lib/content"
import type { Post } from "@/lib/content"
import type { Metadata } from "next"
import { TestimonialsCarousel } from "@/components/ui/testimonials-carousel"
import { RetailCarousel } from "@/components/ui/retail-carousel"
import { ProductCard } from "@/components/catalog/ProductCard"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "誠真生活 RealReal — 純淨植物力，為你的健康加分",
  description:
    "誠真生活是台灣在地純素食品品牌，嚴選天然植物原料，堅持無添加、無負擔，為你帶來純粹的植物營養。",
  openGraph: {
    title: "誠真生活 RealReal",
    description: "純淨植物力，為你的健康加分",
    type: "website",
  },
}

/* ---------- data fetching ---------- */

async function getPinnedProducts(): Promise<Product[]> {
  try {
    // 置頂 (is_featured) products first; fall back to the default listing so the
    // homepage spotlight is never empty when nothing is pinned yet.
    const { data } = await getProducts({ featured: true, limit: 8 })
    if (data.length > 0) return data
    const { data: fallback } = await getProducts({ limit: 8 })
    return fallback
  } catch {
    return []
  }
}

/* ---------- sections ---------- */

type HeroContent = {
  heading?: string
  subheading?: string
  cta_text?: string
  cta_link?: string
  image?: string
  image_scale?: number      // percent, e.g. 100 = fill width, 60 = 60% scaled
  image_position_x?: number // 0–100, default 50
  image_position_y?: number // 0–100, default 50
}

function HeroSection({ content }: { content?: HeroContent | null }) {
  const banner = content?.image || "/home/banner.jpg"

  return (
    <section>
      <img src={banner} alt="" className="w-full block" />
    </section>
  )
}

const HOME_BLOCKS = [
  { img: "/home/block1.png", alt: "三種植物蛋白", href: "/blog/why-three-plant-proteins" },
  { img: "/home/block2.png", alt: "真實果粒口感", href: "/blog/story-of-rr-vegan-portein-powder" },
  { img: "/home/block3.png", alt: "公益存款計畫", href: "/idea" },
  { img: "/home/block4.png", alt: "會員專屬回饋", href: "/membership" },
]

function HomeSquareImages() {
  return (
    <section className="px-3 sm:px-4 py-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5">
        {HOME_BLOCKS.map((block) => (
          <Link
            key={block.alt}
            href={block.href}
            className="group relative overflow-hidden rounded-xl sm:rounded-2xl block aspect-square"
          >
            <img
              src={block.img}
              alt={block.alt}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
            {/* Bottom gradient — ready for designer's text overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          </Link>
        ))}
      </div>
    </section>
  )
}

function FeatureCardsSection() {
  const cards = [
    {
      src: "/brand/card1.jpg",
      alt: "聰明生活科普文章",
      label: "聰明生活",
      href: "/blog",
    },
    {
      src: "/brand/card2.jpg",
      alt: "了解我們的產品",
      label: "了解產品",
      href: "/shop",
    },
    {
      src: "/brand/card3.jpg",
      alt: "公益里程計畫",
      label: "公益里程",
      href: "/idea",
    },
  ]

  return (
    <section className="py-6 sm:py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group relative block aspect-square overflow-hidden rounded-xl"
            >
              <Image
                src={card.src}
                alt={card.alt}
                fill
                sizes="(max-width: 640px) 100vw, 33vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              {/* subtle dark overlay */}
              <div className="absolute inset-0 bg-black/25 transition-colors duration-300 group-hover:bg-black/35" />
              {/* label */}
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <p
                  className="text-lg font-bold text-white tracking-wide"
                  style={{ fontFamily: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif" }}
                >
                  {card.label}
                </p>
                <p className="mt-1 text-xs text-white/80">了解更多 →</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

function ProductSection({
  title,
  subtitle,
  products,
  moreLabel,
  moreHref,
}: {
  title: string
  subtitle?: string
  products: Product[]
  moreLabel: string
  moreHref: string
}) {
  return (
    <section className="pt-8 pb-10 sm:pt-10 sm:pb-14">
      <div className="px-3 sm:px-4">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#10305a] sm:text-3xl">
          {title}
        </h2>
        {subtitle && (
          <p className="text-center text-sm text-zinc-500 mt-1">{subtitle}</p>
        )}

        <div className="mt-7 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>

        {products.length > 0 && (
          <div className="mt-7 text-center">
            <Button
              asChild
              variant="outline"
              size="lg"
              className="rounded-[10px] border-[#10305a]/30 text-[#10305a] hover:bg-[#10305a]/5 px-8"
            >
              <Link href={moreHref}>{moreLabel}</Link>
            </Button>
          </div>
        )}

        {products.length === 0 && (
          <p className="mt-10 text-center text-[#687279]">商品即將上架，敬請期待。</p>
        )}
      </div>
    </section>
  )
}

function BlogSection({ posts }: { posts: Post[] }) {
  // Fallback to hardcoded placeholder if no real posts
  const fallbackPosts = [
    {
      title: "植物蛋白vs動物蛋白：你該知道的事",
      excerpt: "了解兩者差異，選擇最適合自己的蛋白質來源。",
    },
    {
      title: "凍乾水果的營養價值完整保留嗎？",
      excerpt: "科學解析凍乾技術如何鎖住水果的天然營養。",
    },
    {
      title: "純素飲食入門指南",
      excerpt: "從日常飲食開始，輕鬆踏上純素生活的第一步。",
    },
  ]

  const hasPosts = posts.length > 0

  return (
    <section className="py-10 sm:py-14">
      <div className="px-3 sm:px-4">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#10305a] sm:text-3xl">
          聰明生活
        </h2>
        <p className="text-center text-sm text-zinc-500 mt-1">把複雜的健康知識，變成簡單的生活選擇。</p>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hasPosts
            ? posts.map((post) => (
                <Link
                  key={post.id}
                  href={`/blog/${post.slug}`}
                  className="group"
                >
                  <Card className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow">
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
                        <div className="flex h-full w-full items-center justify-center text-[#10305a]/20 text-4xl">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="40"
                            height="40"
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
                    </CardContent>
                  </Card>
                </Link>
              ))
            : fallbackPosts.map((post) => (
                <Card
                  key={post.title}
                  className="overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="aspect-[16/9] bg-gradient-to-br from-[#f5f0fa] to-[#faf6f2] flex items-center justify-center">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="40"
                      height="40"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-[#10305a]/20"
                    >
                      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
                      <path d="M18 14h-8" />
                      <path d="M15 18h-5" />
                      <path d="M10 6h8v4h-8V6Z" />
                    </svg>
                  </div>
                  <CardContent className="p-5">
                    <h3 className="font-semibold text-[#10305a] line-clamp-2">
                      {post.title}
                    </h3>
                    <p className="mt-2 text-sm text-[#687279] line-clamp-2">
                      {post.excerpt}
                    </p>
                  </CardContent>
                </Card>
              ))}
        </div>

        {hasPosts && (
          <div className="mt-10 text-center">
            <Button
              asChild
              variant="outline"
              size="lg"
              className="rounded-[10px] border-[#10305a]/30 text-[#10305a] hover:bg-[#10305a]/5 px-8"
            >
              <Link href="/blog">查看更多文章 →</Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

function RetailSection() {
  const entries = [
    // 出攤活動（最新活動排最前）
    {
      name: "台北閱野假期閱讀節",
      type: "出攤活動",
      address: "台北市中正區永綏街7號街道（中山堂對面）",
      dates: "2026/7/18–19（六、日）",
      hours: "13:00–18:00",
      mapUrl: "https://maps.app.goo.gl/jdv9rmJ1sFTz8Qbe7",
      icon: "📚",
    },
    {
      name: "南港軟體園區樂購商場",
      type: "出攤活動",
      address: "南港軟體園區樂購商場",
      dates: "2026/7/9、16、23、30（每週四）",
      hours: "11:30–14:00",
      mapUrl: "https://share.google/h4UonhL1F99N77ut2",
      icon: "🛍️",
    },
    // 實體通路（由南至北）
    {
      name: "仙卉生機園地",
      type: "生機店",
      address: "彰化縣溪湖鎮郵政街27號",
      phone: "(04) 882-1260",
      fbUrl: "https://www.facebook.com/share/1C9Wk8UDW8/?mibextid=wwXIfr",
      icon: "🌿",
    },
    {
      name: "夢田藥局",
      type: "藥局",
      address: "桃園市中壢區龍慈路91號1樓",
      phone: "(03) 460-1966",
      mapUrl: "https://share.google/vZ79fBx7uAgcFZUMx",
      icon: "💊",
    },
    {
      name: "原粹蔬食作",
      type: "蔬食店",
      address: "新北市新店區北新路三段206巷1弄7號",
      phone: "(02) 8914-7185",
      mapUrl: "https://maps.app.goo.gl/zUmLshtYtRhnmLp87",
      icon: "🥗",
    },
    {
      name: "新埔健保藥局",
      type: "藥局",
      address: "新北市板橋區自由路2號",
      phone: "(02) 2255-8878",
      mapUrl: "https://maps.app.goo.gl/Ug2Jy4SVUDupV4TN8?g_st=ic",
      icon: "💊",
    },
  ]

  return (
    <section className="py-10 sm:py-14 bg-white border-t border-gray-100">
      <div className="text-center mb-10 px-3 sm:px-4">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#10305a" }}>
          在生活裡相遇
        </h2>
        <p className="mt-2 text-sm" style={{ color: "#687279" }}>
          從螢幕到街角，把誠真生活帶回家。
        </p>
      </div>
      <div className="px-3 sm:px-8">
        <RetailCarousel entries={entries} />
      </div>
    </section>
  )
}


/* ---------- page ---------- */

export default async function HomePage() {
  // Resolve category slugs for the two product sections
  // Fetch products, content and blog posts in parallel
  const [pinnedProducts, heroContent, allPostsResult, testimonialResult] =
    await Promise.all([
      getPinnedProducts(),
      getSiteContent<HeroContent>("homepage_hero"),
      getPosts({ limit: 20 }),
      getPosts({ category: "真實見證", limit: 10 }),
    ])

  const testimonialPosts = testimonialResult.data
  const nonTestimonialPosts = allPostsResult.data
    .filter((p) => p.category !== "真實見證")
    .slice(0, 3)

  return (
    <main className="min-h-screen">
      {/* 1. Hero */}
      <HeroSection content={heroContent} />

      {/* 1a. 精選商品 (置頂) */}
      <ProductSection
        title="從這裡開始認識誠真"
        subtitle="最受歡迎的產品與風味。"
        products={pinnedProducts}
        moreLabel="查看全部商品 →"
        moreHref="/shop"
      />

      {/* 1b. Square images */}
      <HomeSquareImages />

      {/* 真實見證 posts */}
      <section className="py-10 sm:py-12">
        <div className="px-3 sm:px-4">
          <h2 className="text-center text-2xl font-bold tracking-tight text-[#10305a] sm:text-3xl mb-2">
            真實見證
          </h2>
          <p className="text-center text-sm text-zinc-500 mb-0">從學生到退休生活，不同人生階段的共同選擇。</p>
          <TestimonialsCarousel posts={testimonialPosts} />
        </div>
      </section>

      {/* 聰明生活 — non-testimonial posts */}
      <BlogSection posts={nonTestimonialPosts} />

      {/* 7. Retail stores */}
      <RetailSection />
    </main>
  )
}
