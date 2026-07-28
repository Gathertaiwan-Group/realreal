import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { Product } from "@/lib/catalog"
import { KolLandingClient } from "./_client"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

/**
 * KOL landing page  —  /k/<slug>
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md (Section 5).
 * Recommended-products behaviour updated per
 * docs/superpowers/specs/2026-07-28-kol-recommended-products-design.md —
 * products now come from the KOL's own `recommended_product_ids`
 * (already resolved server-side by GET /kols/:slug), not a global
 * is_featured fetch.
 *
 * Server component: fetch the public KOL record (which now includes its
 * recommended products) and pass everything to <KolLandingClient /> for
 * rendering and the fire-and-forget click-tracking POST.
 */

export type KolCoupon = {
  id: string
  code: string
  type: "percentage" | "fixed"
  value: number
}

export type Kol = {
  id: string
  slug: string
  name: string
  avatar_url: string | null
  bio: string | null
  socials: {
    instagram: string | null
    youtube: string | null
    tiktok: string | null
  }
  coupon: KolCoupon | null
  products: Product[]
}

async function getKol(slug: string): Promise<Kol | null> {
  try {
    const res = await fetch(`${API_URL}/kols/${encodeURIComponent(slug)}`, {
      // Landing pages should reflect admin edits quickly; small revalidate window.
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: Kol }
    return json.data ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const kol = await getKol(slug)
  if (!kol) {
    return { title: "KOL not found" }
  }
  return {
    title: `${kol.name} — 誠真生活 RealReal 專屬連結`,
    description: kol.bio ?? `透過 ${kol.name} 的專屬連結進入誠真生活 RealReal，享受 KOL 限定折扣。`,
  }
}

export default async function KolLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const kol = await getKol(slug)
  if (!kol) {
    notFound()
  }

  return <KolLandingClient kol={kol} products={kol.products} />
}
