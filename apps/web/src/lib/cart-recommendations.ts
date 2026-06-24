/**
 * Cart drawer "你也可能喜歡" recommendations.
 *
 * Priority: products the shop explicitly flagged is_recommended (an admin
 * toggle, like is_addon) come first; when there aren't enough, fall back to
 * best-selling, then any active product — so the strip is never empty. Every
 * tier excludes items already in the cart / out of stock. Cheap, predictable,
 * no recommendation engine.
 *
 * The /products endpoint supports ?is_recommended=true and sort=best_selling
 * and returns each product's default variant id + price + stock, which is
 * exactly what we need for the one-click "+ 加" CTA.
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
  // 加購品只在購物車的「加購商品區」顯示，這裡要排除，避免同商品兩區重複。
  is_addon?: boolean
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

async function fetchProductsList(
  apiUrl: string,
  query: string,
): Promise<ApiProduct[]> {
  const res = await fetch(`${apiUrl}/products?${query}`, {
    next: { revalidate: 300 },
  })
  if (!res.ok) return []
  const json = (await res.json()) as { data?: ApiProduct[] }
  return json.data ?? []
}

export async function fetchRecommendations(
  excludeVariantIds: string[] = [],
  limit = 4,
): Promise<RecommendedProduct[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  const total = limit + excludeVariantIds.length

  const queries = [
    `is_recommended=true&limit=${total}`,
    `sort=best_selling&limit=${total}`,
    `limit=${total}`,
  ]

  for (const query of queries) {
    try {
      const products = await fetchProductsList(apiUrl, query)
      const out: RecommendedProduct[] = []
      for (const p of products) {
        const v = p.default_variant ?? p.variants?.[0]
        if (!v) continue
        if (excludeVariantIds.includes(v.id)) continue
        // 加購品歸「加購商品區」，「你也可能喜歡」只顯示一般商品（原價、無限制）。
        if (p.is_addon) continue
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
      if (out.length > 0) return out
    } catch {
      continue
    }
  }
  return []
}
