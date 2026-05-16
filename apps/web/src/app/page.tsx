import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ReviewImagesCarousel } from "@/components/ui/review-images-carousel"
import { getProducts, getCategories } from "@/lib/catalog"
import type { Product, Category } from "@/lib/catalog"
import { getSiteContent, getPosts } from "@/lib/content"
import type { Post } from "@/lib/content"
import type { Metadata } from "next"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "誠真生活 RealReal — 純淨植物力，為你的健康加分",
  description:
    "誠真生活是台灣在地純素健康食品品牌，嚴選天然植物原料，堅持無添加、無負擔，為你帶來純粹的植物營養。",
  openGraph: {
    title: "誠真生活 RealReal",
    description: "純淨植物力，為你的健康加分",
    type: "website",
  },
}

/* ---------- data fetching ---------- */

async function getProductsByCategory(categorySlug: string): Promise<Product[]> {
  try {
    const { data } = await getProducts({ category: categorySlug, limit: 4 })
    return data
  } catch {
    return []
  }
}

async function findCategorySlug(needle: string): Promise<string | undefined> {
  const categories = await getCategories()
  return categories.find(
    (c: Category) =>
      c.name.includes(needle) || c.slug.includes(needle)
  )?.slug
}

/* ---------- sections ---------- */

function AnnouncementBar() {
  const messages = [
    "加入會員立即享 95 折優惠",
    "消費滿 499 超取免運",
    "消費滿 999 宅配免運",
  ]
  // Duplicate messages so the marquee loops seamlessly
  const items = [...messages, ...messages]

  return (
    <div className="overflow-hidden bg-[#10305a] text-white py-2 text-sm">
      <div className="flex animate-marquee whitespace-nowrap">
        {items.map((msg, i) => (
          <span key={i} className="mx-8 inline-flex items-center gap-2">
            <span className="text-yellow-300">★</span>
            {msg}
          </span>
        ))}
      </div>
    </div>
  )
}

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
  const heading = content?.heading ?? "自純淨中補給，在誠真中安心"
  const ctaText = content?.cta_text ?? "立即選購"
  const ctaLink = content?.cta_link ?? "/shop"
  const bgImage = content?.image || "/brand/hero-banner.jpg"
  const bgScale = content?.image_scale ?? 100
  const bgPosX = content?.image_position_x ?? 50
  const bgPosY = content?.image_position_y ?? 50

  const bodyLines = [
    "補充體力、維持精神",
    "身體好吸收、不負擔的營養",
    "每一天，都多一點力氣與穩定",
    "身心安然",
    "回到自在的生活節奏",
  ]

  return (
    <section className="relative overflow-hidden min-h-[75vh] lg:min-h-[82vh] flex items-center">
      {/* Background image — CSS-driven so scale & position are fully controllable */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url('${bgImage}')`,
          backgroundSize: `${bgScale}%`,
          backgroundPosition: `${bgPosX}% ${bgPosY}%`,
          backgroundRepeat: "no-repeat",
          backgroundColor: "#eef3f9",
        }}
      />
      {/* Gradient overlay — left bright, right reveals image */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(to right, rgba(238,243,249,0.97) 0%, rgba(238,243,249,0.92) 40%, rgba(238,243,249,0.55) 65%, rgba(238,243,249,0) 100%)" }}
      />

      <div className="relative z-10 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-16 md:py-20 lg:py-28">
        <div className="max-w-xl">
          {/* Eyebrow */}
          <p className="text-xs font-semibold uppercase tracking-[0.2em] mb-4" style={{ color: "#10305a", opacity: 0.5 }}>
            純淨植物力，為你的生活加分
          </p>

          {/* Heading — nowrap so it stays on one line */}
          <h1
            className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-[3.2rem] lg:leading-[1.2] whitespace-nowrap"
            style={{ color: "#10305a" }}
          >
            {heading}
          </h1>

          {/* Body copy — subheading stored as \n-separated lines */}
          <div className="mt-6 space-y-1 text-[15px] leading-[1.85]" style={{ color: "#687279" }}>
            {content?.subheading
              ? content.subheading.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)
              : bodyLines.map((line, i) => <p key={i}>{line}</p>)
            }
          </div>

          {/* CTA buttons */}
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="rounded-full px-8 text-[15px] h-12 font-semibold shadow-sm"
              style={{ backgroundColor: "#10305a", color: "#fff" }}
            >
              <Link href={ctaLink}>{ctaText}</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="rounded-full px-8 text-[15px] h-12 hover:bg-[#10305a]/5"
              style={{ borderColor: "rgba(16,48,90,0.3)", color: "#10305a" }}
            >
              <Link href="/about">了解品牌</Link>
            </Button>
          </div>

          {/* Trust badges */}
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs" style={{ color: "#687279" }}>
            {["純植物來源", "無添加糖", "台灣製造", "vegan 友善"].map(badge => (
              <span key={badge} className="flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "rgba(16,48,90,0.4)" }} />
                {badge}
              </span>
            ))}
          </div>
        </div>
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

function MembershipSection() {
  const tiers = [
    {
      name: "初心之友",
      stars: 1,
      benefits: [
        "常態 95折",
        "消費 2.3% 累積公益存款或購物金",
        "生日 95折 + 公益存款雙倍",
      ],
      qualification: "註冊即可成為",
    },
    {
      name: "知心之友",
      stars: 2,
      benefits: [
        "常態 95折",
        "消費 3.3% 累積公益存款或購物金",
        "生日 9折 + 公益存款雙倍",
        "線上講座參與資格",
      ],
      qualification: "累計消費滿 NT$3,500",
    },
    {
      name: "同心之友",
      stars: 3,
      benefits: [
        "常態 9折",
        "消費 3.3% 累積公益存款或購物金",
        "生日公益存款雙倍 + 專屬生日禮",
        "線上 + 實體活動參與資格",
      ],
      qualification: "累計消費滿 NT$12,000",
    },
  ]

  return (
    <section className="bg-[#fffeee] py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#10305a] sm:text-3xl">
          消費額 2.3% 累積公益存款或購物金
        </h2>

        {/* Membership tier image from WordPress */}
        <div className="mt-10">
          <Image
            src="https://realreal.cc/wp-content/uploads/2026/01/會員制度表0106-2.png"
            alt="會員等級：初心之友、知心之友、同心之友"
            width={1800}
            height={600}
            className="mx-auto w-full max-w-5xl rounded-xl"
            unoptimized
          />
        </div>

        {/* Option B: Tailwind tier cards (always rendered below for accessibility / SEO) */}
        <div className="sr-only">
          {tiers.map((tier) => (
            <div key={tier.name}>
              <h3>{tier.name}</h3>
              <ul>
                {tier.benefits.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p>{tier.qualification}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ProductSection({
  title,
  products,
  moreLabel,
  moreHref,
}: {
  title: string
  products: Product[]
  moreLabel: string
  moreHref: string
}) {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#10305a] sm:text-3xl">
          {title}
        </h2>

        <div className="mt-10 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {products.map((product) => {
            const image = product.images?.[0]
            return (
              <Link
                key={product.id}
                href={`/shop/${product.slug}`}
                className="group"
              >
                <Card className="overflow-hidden border-0 shadow-sm hover:shadow-lg transition-shadow duration-300">
                  <div className="aspect-square relative bg-zinc-50 overflow-hidden">
                    {image ? (
                      <Image
                        src={image}
                        alt={product.name}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-300 text-sm">
                        無圖片
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4">
                    <p className="font-medium text-sm text-[#10305a] line-clamp-2">
                      {product.name}
                    </p>
                    {product.min_price != null && product.min_price > 0 && (
                      <p className="mt-1 text-sm font-semibold text-[#687279]">
                        NT$ {product.min_price.toLocaleString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>

        {products.length > 0 && (
          <div className="mt-10 text-center">
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
    <section className="bg-[#fffeee] py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#10305a] sm:text-3xl">
          聰明過生活
        </h2>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
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

type Testimonial = { name: string; text: string; rating?: number }

const defaultReviews: Testimonial[] = [
  {
    name: "小美",
    text: "喝了一個月的植物蛋白粉，精神變得好多！味道也很好入口，推薦給怕奶味的人。",
  },
  {
    name: "阿凱",
    text: "凍乾水果真的超方便，帶去辦公室當零食，同事都問我在哪裡買的。",
  },
  {
    name: "Jenny",
    text: "很喜歡誠真的理念，買東西還能做公益，而且產品品質真的很好！",
  },
]


function ReviewsSection({ testimonials }: { testimonials?: Testimonial[] | null }) {
  const reviews = testimonials && testimonials.length > 0 ? testimonials : defaultReviews

  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[#10305a] sm:text-3xl">
          使用者真實回饋
        </h2>

        {/* DB-driven text testimonials */}
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => (
            <Card
              key={review.name}
              className="border-0 bg-[#f9f9f6] shadow-sm p-6"
            >
              <div className="flex items-center gap-1 text-yellow-400 text-lg mb-3">
                {"★".repeat(review.rating ?? 5)}
              </div>
              <p className="text-sm leading-relaxed text-[#687279] italic">
                &ldquo;{review.text}&rdquo;
              </p>
              <p className="mt-4 text-sm font-semibold text-[#10305a]">
                — {review.name}
              </p>
            </Card>
          ))}
        </div>

        {/* Real customer review screenshots - carousel */}
        <ReviewImagesCarousel />
      </div>
    </section>
  )
}

function RetailSection() {
  const stores = [
    {
      name: "新埔健保藥局",
      type: "藥局",
      address: "新北市板橋區自由路2號",
      phone: "(02) 2255-8878",
      mapUrl: "https://maps.app.goo.gl/Ug2Jy4SVUDupV4TN8?g_st=ic",
      fbUrl: null,
      icon: "💊",
    },
    {
      name: "仙卉生機園地",
      type: "生機店",
      address: "彰化縣溪湖鎮郵政街27號",
      phone: "(04) 882-1260",
      mapUrl: null,
      fbUrl: "https://www.facebook.com/share/1C9Wk8UDW8/?mibextid=wwXIfr",
      icon: "🌿",
    },
  ]

  return (
    <section className="py-16 sm:py-20 bg-white border-t border-gray-100">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#10305a]/40 mb-2">線下也找得到我們</p>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#10305a" }}>
            實體通路
          </h2>
          <p className="mt-2 text-sm" style={{ color: "#687279" }}>
            在誠真的合作夥伴門市，也能選購我們的商品
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {stores.map(store => (
            <div
              key={store.name}
              className="rounded-2xl border border-gray-100 bg-[#f9fafb] p-6 flex flex-col gap-4"
              style={{ boxShadow: "2px 2px 12px 0 rgba(16,48,90,.06)" }}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{store.icon}</span>
                <div>
                  <span
                    className="inline-block text-xs font-semibold rounded-full px-2.5 py-0.5 mb-1.5"
                    style={{ background: "#e8f0f7", color: "#10305a" }}
                  >
                    {store.type}
                  </span>
                  <h3 className="text-base font-bold" style={{ color: "#10305a" }}>{store.name}</h3>
                </div>
              </div>

              <div className="space-y-1.5 text-sm" style={{ color: "#687279" }}>
                <p className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">📍</span>
                  {store.address}
                </p>
                <p className="flex items-center gap-2">
                  <span className="shrink-0">📞</span>
                  <a href={`tel:${store.phone.replace(/[^0-9]/g, "")}`} className="hover:underline">
                    {store.phone}
                  </a>
                </p>
              </div>

              <div className="flex gap-2 mt-1">
                {store.mapUrl && (
                  <a
                    href={store.mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors"
                    style={{ background: "#10305a", color: "#fff" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Google Maps
                  </a>
                )}
                {store.fbUrl && (
                  <a
                    href={store.fbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors"
                    style={{ background: "#10305a", color: "#fff" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                    Facebook
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}


/* ---------- page ---------- */

export default async function HomePage() {
  // Resolve category slugs for the two product sections
  const [proteinSlug, fruitSlug] = await Promise.all([
    findCategorySlug("蛋白"),
    findCategorySlug("凍乾"),
  ])

  // Fetch products, content and blog posts in parallel
  const [proteinProducts, fruitProducts, heroContent, blogResult, testimonials] =
    await Promise.all([
      getProductsByCategory(proteinSlug ?? "protein"),
      getProductsByCategory(fruitSlug ?? "freeze-dried"),
      getSiteContent<HeroContent>("homepage_hero"),
      getPosts({ limit: 3 }),
      getSiteContent<Testimonial[]>("testimonials"),
    ])

  return (
    <main className="min-h-screen">
      {/* 0. Announcement bar (marquee) */}
      <AnnouncementBar />

      {/* 1. Hero */}
      <HeroSection content={heroContent} />

      {/* 1b. Feature cards (below hero) */}
      <FeatureCardsSection />

      {/* 2. Membership tiers */}
      <MembershipSection />

      {/* 3. Product section: 純植物蛋白粉 */}
      <ProductSection
        title="純植物蛋白粉"
        products={proteinProducts}
        moreLabel="查看更多植物蛋白 →"
        moreHref={`/shop${proteinSlug ? `?category=${proteinSlug}` : ""}`}
      />

      {/* 4. Product section: 原相凍乾水果 */}
      <div className="bg-[#fffeee]">
        <ProductSection
          title="原相凍乾水果"
          products={fruitProducts}
          moreLabel="查看更多凍乾水果 →"
          moreHref={`/shop${fruitSlug ? `?category=${fruitSlug}` : ""}`}
        />
      </div>

      {/* 5. Customer reviews (before blog, matching WordPress order) */}
      <ReviewsSection testimonials={testimonials} />

      {/* 6. Blog section */}
      <BlogSection posts={blogResult.data} />

      {/* 7. Retail stores */}
      <RetailSection />
    </main>
  )
}
