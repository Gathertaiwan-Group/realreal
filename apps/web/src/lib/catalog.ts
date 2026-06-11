const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

export type Category = { id: string; name: string; slug: string; parent_id: string | null; sort_order: number; product_count?: number; children?: Category[] }
export type ProductVariant = { id: string; name: string; price: string; sale_price: string | null; stock_qty: number; sku: string | null; weight?: number | null; attributes: Record<string, string | number> | null }
export type Product = { id: string; name: string; slug: string; description: string | null; excerpt: string | null; images: string[] | null; is_active: boolean; is_featured: boolean; is_addon: boolean; display_priority: number; category_id: string | null; created_at: string; min_price?: number; max_price?: number; total_stock?: number; sales_count?: number }

export type SortOption = "newest" | "price_asc" | "price_desc" | "best_selling"

export async function getCategories(): Promise<Category[]> {
  const res = await fetch(`${API_URL}/categories`, { cache: "no-store" })
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? []
}

export async function getProducts(params?: { page?: number; limit?: number; category?: string; q?: string; sort?: SortOption }): Promise<{ data: Product[]; total: number }> {
  const sp = new URLSearchParams()
  if (params?.page) sp.set("page", String(params.page))
  if (params?.limit) sp.set("limit", String(params.limit))
  if (params?.category) sp.set("category", params.category)
  if (params?.q) sp.set("q", params.q)
  if (params?.sort) sp.set("sort", params.sort)
  const res = await fetch(`${API_URL}/products?${sp}`, { next: { revalidate: 60 } })
  if (!res.ok) return { data: [], total: 0 }
  return res.json()
}

export async function getProductBySlug(slug: string): Promise<(Product & { variants: ProductVariant[] }) | null> {
  const res = await fetch(`${API_URL}/products/${slug}`, { next: { revalidate: 60 } })
  if (!res.ok) return null
  const json = await res.json()
  return json.data ?? null
}
