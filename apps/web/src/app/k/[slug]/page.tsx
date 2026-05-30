import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { getProducts, type Product } from "@/lib/catalog"
import { KolLandingClient } from "./_client"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

/**
 * KOL landing page  —  /k/<slug>
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md (Section 5).
 *
 * Server component: fetch the public KOL record + a small batch of featured
 * products and pass everything to <KolLandingClient /> for rendering and the
 * fire-and-forget click-tracking POST.
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

async function getFeaturedProducts(): Promise<Product[]> {
  try {
    const res = await fetch(`${API_URL}/products?featured_only=true&limit=8`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: Product[] }
    return json.data ?? []
  } catch {
    return []
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

  const products = await getFeaturedProducts()

  return <KolLandingClient kol={kol} products={products} />
}
