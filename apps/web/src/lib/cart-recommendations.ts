/**
 * Cart drawer "你也可能喜歡" recommendations.
 *
 * Strategy: best-selling products that aren't already in the cart. Cheap,
 * predictable, and doesn't need a recommendation engine.
 *
 * The /products endpoint already supports sort=best_selling and returns
 * each product's default variant id + price + stock, which is exactly
 * what we need for the one-click "+ 加" CTA.
 */

export interface RecommendedProduct {
  id: string
  name: string
  slug: string
  variantId: string
  variantName: string
  price: number
  stockQty: number
  imageUrl?: string
}

interface ApiProduct {
  id: string
  name: string
  slug: string
  images?: string[] | null
  variants?: Array<{
    id: string
    name: string
    price: number | string
    stock_qty: number | string
  }>
  default_variant?: {
    id: string
    name: string
    price: number | string
    stock_qty: number | string
  } | null
}

export async function fetchRecommendations(
  excludeVariantIds: string[] = [],
  limit = 4,
): Promise<RecommendedProduct[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  try {
    const res = await fetch(
      `${apiUrl}/products?sort=best_selling&limit=${limit + excludeVariantIds.length}`,
      { next: { revalidate: 300 } },
    )
    if (!res.ok) return []
    const json = (await res.json()) as { data?: ApiProduct[] }
    const products = json.data ?? []

    const out: RecommendedProduct[] = []
    for (const p of products) {
      // Prefer default_variant if the API returns it, otherwise first variant
      const v = p.default_variant ?? p.variants?.[0]
      if (!v) continue
      if (excludeVariantIds.includes(v.id)) continue
      const price = Number(v.price)
      const stock = Number(v.stock_qty)
      if (!Number.isFinite(price) || stock <= 0) continue
      out.push({
        id: p.id,
        name: p.name,
        slug: p.slug,
        variantId: v.id,
        variantName: v.name,
        price,
        stockQty: stock,
        imageUrl: p.images?.[0],
      })
      if (out.length >= limit) break
    }
    return out
  } catch {
    return []
  }
}
