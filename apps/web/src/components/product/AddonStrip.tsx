"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { useCart } from "@/lib/cart"

interface AddonProduct {
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
  default_variant?: { id: string; name: string; price: number | string; stock_qty: number | string } | null
  variants?: Array<{ id: string; name: string; price: number | string; stock_qty: number | string }>
}

async function fetchAddons(
  apiUrl: string,
  excludeVariantIds: string[],
  limit: number,
): Promise<AddonProduct[]> {
  const total = limit + excludeVariantIds.length
  const candidates = [
    `${apiUrl}/products?is_addon=true&limit=${total}`,
    `${apiUrl}/products?sort=best_selling&limit=${total}`,
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { next: { revalidate: 300 } })
      if (!res.ok) continue
      const json = (await res.json()) as { data?: ApiProduct[] }
      const out: AddonProduct[] = []
      for (const p of json.data ?? []) {
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
      if (out.length > 0) return out
    } catch {
      continue
    }
  }
  return []
}

export function AddonStrip({
  excludeVariantIds = [],
  limit = 6,
  title = "加購區",
}: {
  excludeVariantIds?: string[]
  limit?: number
  title?: string
}) {
  const [products, setProducts] = useState<AddonProduct[]>([])
  const addItem = useCart((s) => s.addItem)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

  useEffect(() => {
    fetchAddons(apiUrl, excludeVariantIds, limit).then(setProducts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (products.length === 0) return null

  return (
    <div className="mt-6 space-y-3">
      <p className="text-sm font-semibold text-zinc-500 border-t pt-4">{title}</p>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-thin">
        {products.map((p) => (
          <div
            key={p.id}
            className="flex shrink-0 w-[140px] flex-col gap-2 rounded-xl border bg-white p-2"
          >
            <Link href={`/shop/${p.slug}`}>
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  className="h-[116px] w-full rounded-lg object-cover"
                />
              ) : (
                <div className="h-[116px] w-full rounded-lg bg-zinc-100 flex items-center justify-center text-xs text-zinc-400">
                  無圖
                </div>
              )}
            </Link>
            <Link href={`/shop/${p.slug}`}>
              <p className="text-xs font-medium leading-snug line-clamp-2 text-[#10305a]">{p.name}</p>
            </Link>
            <div className="flex items-center justify-between gap-1 mt-auto">
              <span className="text-xs font-semibold text-[#10305a]">
                NT$ {p.price.toLocaleString()}
              </span>
              <button
                type="button"
                className="flex h-7 items-center gap-0.5 rounded-lg border border-[#10305a] px-2 text-xs font-medium text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
                onClick={() =>
                  addItem({
                    variantId: p.variantId,
                    productName: p.name,
                    variantName: p.variantName,
                    price: p.price,
                    qty: 1,
                    stockQty: p.stockQty,
                    imageUrl: p.imageUrl,
                  })
                }
                aria-label={`加入 ${p.name}`}
              >
                <Plus className="h-3 w-3" /> 加入
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
