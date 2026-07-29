import { supabase } from "./supabase"

// Helper: enrich products with prices, total_stock, and flatten image URLs.
// Shared by routes/products.ts (GET /products, GET /products/:slug) and
// routes/kols.ts (GET /kols/:slug recommended products) — moved here so
// route files don't import from one another.
export async function enrichProducts(products: any[]) {
  if (products.length === 0) return products

  const productIds = products.map((p) => p.id)
  const { data: variants } = await supabase
    .from("product_variants")
    .select("product_id, price, sale_price, stock_qty")
    .in("product_id", productIds)

  const statsMap = new Map<string, { min_price: number | null; max_price: number | null; min_sale_price: number | null; total_stock: number }>()
  for (const v of variants ?? []) {
    const entry = statsMap.get(v.product_id)
    const price = Number(v.price)
    const salePrice = v.sale_price != null ? Number(v.sale_price) : null
    const effectivePrice = salePrice != null && salePrice < price ? salePrice : price
    const stock = Number(v.stock_qty) || 0
    if (!entry) {
      statsMap.set(v.product_id, { min_price: price, max_price: price, min_sale_price: effectivePrice, total_stock: stock })
    } else {
      if (entry.min_price === null || price < entry.min_price) entry.min_price = price
      if (entry.max_price === null || price > entry.max_price) entry.max_price = price
      if (entry.min_sale_price === null || effectivePrice < entry.min_sale_price) entry.min_sale_price = effectivePrice
      entry.total_stock += stock
    }
  }

  return products.map((p) => {
    const stats = statsMap.get(p.id)
    // Flatten images: DB stores {url, alt, sort_order}[] — extract just the URL strings
    let images: string[] | null = null
    if (Array.isArray(p.images) && p.images.length > 0) {
      if (typeof p.images[0] === "string") {
        images = p.images
      } else {
        const sorted = [...p.images].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        images = sorted.map((img: any) => img.url).filter(Boolean)
      }
    }
    // Remap product_variants -> variants, membership_tiers -> min_tier for frontend compatibility
    const { product_variants, membership_tiers: minTierRaw, ...rest } = p as typeof p & { product_variants?: unknown[]; membership_tiers?: unknown }
    return {
      ...rest,
      images,
      min_price: stats?.min_price ?? null,
      max_price: stats?.max_price ?? null,
      min_sale_price: stats?.min_sale_price ?? null,
      total_stock: stats?.total_stock ?? 0,
      variants: product_variants ?? [],
      min_tier: minTierRaw ?? null,
    }
  })
}
