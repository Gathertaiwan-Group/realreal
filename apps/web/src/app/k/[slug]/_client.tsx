"use client"

import { useEffect } from "react"
import Image from "next/image"
// lucide-react doesn't ship Instagram / Youtube glyphs in this version;
// use generic icons + text label for socials.
import { Camera as Instagram, Video as Youtube } from "lucide-react"
import { ProductCard } from "@/components/catalog/ProductCard"
import type { Product } from "@/lib/catalog"
import { trackKolView } from "@/lib/analytics"
import type { Kol } from "./page"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
const BRAND = "#10305a"

/**
 * Client half of the KOL landing page.
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md (Section 5).
 *
 *  - Hero: avatar + name + bio + social icon links
 *  - Green banner: KOL exclusive discount notice (read coupon value from props)
 *  - Recommended products grid
 *  - On mount: POST /kols/track-click  (fire-and-forget)
 */

// lucide-react in this codebase doesn't ship a TikTok icon — inline a simple
// monochrome glyph that matches the visual weight of Instagram / Youtube.
function TiktokIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V7.83a8.16 8.16 0 0 0 4.77 1.52V5.9a4.85 4.85 0 0 1-1.84-.21z" />
    </svg>
  )
}

function discountLabel(coupon: Kol["coupon"]): string {
  if (!coupon) return ""
  if (coupon.type === "percentage") {
    // commission_rate / coupon value comes through as a number like 10 (= 10%).
    return `${coupon.value}% off`
  }
  // fixed
  return `折抵 NT$${coupon.value.toLocaleString()}`
}

export function KolLandingClient({
  kol,
  products,
}: {
  kol: Kol
  products: Product[]
}) {
  // Fire-and-forget click tracking — do NOT block render or surface errors.
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${API_URL}/kols/track-click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: kol.slug, path: `/k/${kol.slug}` }),
      signal: controller.signal,
      keepalive: true,
    }).catch(() => {
      // Analytics failure must never surface to the user.
    })
    // GA4 view_promotion via GTM dataLayer (spec L §2).
    // No-op in dev / when GTM_ID unset; safe to call unconditionally.
    trackKolView(kol.slug)
    return () => controller.abort()
  }, [kol.slug])

  const instagram = kol.socials.instagram?.trim() || null
  const youtube = kol.socials.youtube?.trim() || null
  const tiktok = kol.socials.tiktok?.trim() || null
  const hasSocials = Boolean(instagram || youtube || tiktok)

  const igHandle = instagram?.replace(/^@/, "")
  const ytHandle = youtube?.replace(/^@/, "")
  const ttHandle = tiktok?.replace(/^@/, "")

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white">
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        {/* ============================== Hero ============================== */}
        <section className="flex flex-col items-center text-center">
          <div
            className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-full overflow-hidden border-4 shadow-md bg-zinc-100"
            style={{ borderColor: BRAND }}
          >
            {kol.avatar_url ? (
              <Image
                src={kol.avatar_url}
                alt={kol.name}
                fill
                sizes="160px"
                className="object-cover"
                priority
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-4xl font-bold"
                style={{ color: BRAND }}
              >
                {kol.name.slice(0, 1)}
              </div>
            )}
          </div>

          <h1
            className="mt-5 text-3xl sm:text-4xl font-bold tracking-tight"
            style={{ color: BRAND }}
          >
            {kol.name}
          </h1>

          {kol.bio && (
            <p className="mt-3 max-w-2xl text-sm sm:text-base leading-relaxed text-zinc-600 whitespace-pre-line">
              {kol.bio}
            </p>
          )}

          {hasSocials && (
            <div className="mt-5 flex items-center justify-center gap-4">
              {igHandle && (
                <a
                  href={`https://instagram.com/${igHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Instagram @${igHandle}`}
                  className="transition-opacity hover:opacity-70"
                  style={{ color: BRAND }}
                >
                  <Instagram className="w-6 h-6" />
                </a>
              )}
              {ytHandle && (
                <a
                  href={`https://youtube.com/@${ytHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`YouTube @${ytHandle}`}
                  className="transition-opacity hover:opacity-70"
                  style={{ color: BRAND }}
                >
                  <Youtube className="w-6 h-6" />
                </a>
              )}
              {ttHandle && (
                <a
                  href={`https://tiktok.com/@${ttHandle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`TikTok @${ttHandle}`}
                  className="transition-opacity hover:opacity-70"
                  style={{ color: BRAND }}
                >
                  <TiktokIcon className="w-6 h-6" />
                </a>
              )}
            </div>
          )}
        </section>

        {/* ========================= Discount banner ========================= */}
        {kol.coupon && (
          <section className="mt-10">
            <div
              className="rounded-lg px-5 py-4 sm:px-6 sm:py-5 text-white shadow-sm flex items-center justify-center text-center"
              style={{ backgroundColor: "#16a34a" }}
            >
              <p className="text-sm sm:text-base font-semibold leading-relaxed">
                你已啟用 KOL <span className="underline underline-offset-2">{kol.name}</span> 的專屬折扣，
                全站結帳自動套用 <span className="font-bold">{discountLabel(kol.coupon)}</span>
              </p>
            </div>
          </section>
        )}

        {/* ====================== Recommended products ====================== */}
        <section className="mt-12">
          <h2
            className="text-2xl font-bold text-center mb-2 tracking-tight"
            style={{ color: BRAND }}
          >
            {kol.name} 推薦商品
          </h2>
          <p className="text-center text-sm mb-8" style={{ color: "#687279" }}>
            精選熱賣商品，立即下單享 KOL 專屬折扣
          </p>

          {products.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-12">
              暫無推薦商品
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {products.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
