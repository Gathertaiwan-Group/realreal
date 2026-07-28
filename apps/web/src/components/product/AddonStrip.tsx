"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { useCart } from "@/lib/cart"

interface AddonProduct {
  id: string
  name: string
  slug: string
  variantId: string
  variantName: string
  price: number
  /** Add-on price (加購價) when set on the variant; otherwise null. */
  addonPrice: number | null
  stockQty: number
  imageUrl?: string
}

type ApiVariant = {
  id: string
  name: string
  price: number | string
  stock_qty: number | string
  addon_price?: number | string | null
}

interface ApiProduct {
  id: string
  name: string
  slug: string
  images?: string[] | null
  default_variant?: ApiVariant | null
  variants?: Array<ApiVariant>
}

async function fetchAddons(
  apiUrl: string,
  excludeVariantIds: string[],
  limit: number,
  onlyAddon = false,
): Promise<AddonProduct[]> {
  const total = limit + excludeVariantIds.length
  // onlyAddon（購物車加購區）一律加購價 → 不用 best_selling 補位
  // （fallback 會拉進沒有加購價的暢銷品，違反「此區一律加購價」）。
  const candidates = onlyAddon
    ? [`${apiUrl}/products?is_addon=true&limit=${total}`]
    : [
        `${apiUrl}/products?is_addon=true&limit=${total}`,
        `${apiUrl}/products?sort=best_selling&limit=${total}`,
      ]
  for (const url of candidates) {
    try {
      const res = await fetch(url)
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
        // 加購價：只有當 API 回傳有效且低於原價時才採用，否則視為無加購價。
        const rawAddon = v.addon_price == null ? NaN : Number(v.addon_price)
        const addonPrice = Number.isFinite(rawAddon) && rawAddon < price ? rawAddon : null
        // onlyAddon：此區一律加購價 → 跳過沒有有效加購價的商品。
        if (onlyAddon && addonPrice == null) continue
        out.push({
          id: p.id,
          name: p.name,
          slug: p.slug,
          variantId: v.id,
          variantName: v.name,
          price,
          addonPrice,
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
  notice,
  onlyAddon = false,
  highlight = false,
}: {
  excludeVariantIds?: string[]
  limit?: number
  title?: string
  /** Optional hint line under the title (e.g. 限量加購提示). */
  notice?: string
  /** Cart 加購區：只收有有效加購價的 is_addon 商品（不 fallback best_selling）。 */
  onlyAddon?: boolean
  /** Cart variant：把段落底色/邊框/padding 收進元件，空清單時整區不渲染。 */
  highlight?: boolean
}) {
  const [products, setProducts] = useState<AddonProduct[]>([])
  const [canScrollPrev, setCanScrollPrev] = useState(false)
  const [canScrollNext, setCanScrollNext] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const addItem = useCart((s) => s.addItem)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

  const excludeKey = excludeVariantIds.join(",")
  useEffect(() => {
    fetchAddons(apiUrl, excludeVariantIds, limit, onlyAddon).then(setProducts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, excludeKey, limit, onlyAddon])

  function updateScrollState() {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollPrev(el.scrollLeft > 4)
    setCanScrollNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  // Re-measure once cards have actually rendered (after products load).
  useEffect(() => {
    updateScrollState()
  }, [products])

  function scrollByPage(dir: 1 | -1) {
    const el = scrollerRef.current
    if (!el) return
    // Advance by roughly one viewport width so "上一頁/下一頁" feels like
    // paging through the carousel rather than nudging by a few pixels.
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" })
  }

  if (products.length === 0) return null

  const showArrows = canScrollPrev || canScrollNext

  return (
    <div className={highlight ? "border-t bg-amber-50/40 px-6 py-4 space-y-2" : "mt-6 space-y-3"}>
      <div className="flex items-center justify-between gap-2">
        <p
          className={
            highlight
              ? "text-sm font-semibold text-[#10305a]"
              : "text-sm font-semibold text-zinc-500 border-t pt-4 flex-1"
          }
        >
          {title}
        </p>
        {showArrows && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => scrollByPage(-1)}
              disabled={!canScrollPrev}
              aria-label="上一頁"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-[#10305a]/30 text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#10305a]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => scrollByPage(1)}
              disabled={!canScrollNext}
              aria-label="下一頁"
              className="flex h-6 w-6 items-center justify-center rounded-full border border-[#10305a]/30 text-[#10305a] transition-colors hover:bg-[#10305a] hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#10305a]"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      {notice && <p className="text-xs font-medium text-amber-600">{notice}</p>}
      <div
        ref={scrollerRef}
        onScroll={updateScrollState}
        className="-mx-1 flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory px-1 pb-2 scrollbar-thin"
      >
        {products.map((p) => (
          <div
            key={p.id}
            className="flex shrink-0 w-[180px] snap-start flex-col gap-2 rounded-xl border bg-white p-2"
          >
            <Link href={`/shop/${p.slug}`}>
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  className="h-[150px] w-full rounded-lg object-cover"
                />
              ) : (
                <div className="h-[150px] w-full rounded-lg bg-zinc-100 flex items-center justify-center text-xs text-zinc-400">
                  無圖
                </div>
              )}
            </Link>
            <Link href={`/shop/${p.slug}`}>
              <p className="text-xs font-medium leading-snug line-clamp-2 text-[#10305a]">{p.name}</p>
            </Link>
            <div className="flex items-center justify-between gap-1 mt-auto">
              {p.addonPrice != null ? (
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="text-xs font-semibold text-[#10305a]">
                    加購價 NT$ {p.addonPrice.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-zinc-400 line-through">
                    NT$ {p.price.toLocaleString()}
                  </span>
                </span>
              ) : (
                <span className="text-xs font-semibold text-[#10305a]">
                  NT$ {p.price.toLocaleString()}
                </span>
              )}
              <button
                type="button"
                className="flex h-7 shrink-0 items-center gap-0.5 rounded-lg border border-[#10305a] px-2 text-xs font-medium text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
                onClick={() =>
                  addItem({
                    variantId: p.variantId,
                    productName: p.name,
                    variantName: p.variantName,
                    price: p.price,
                    qty: 1,
                    stockQty: p.stockQty,
                    imageUrl: p.imageUrl,
                    isAddon: true,
                    ...(p.addonPrice != null ? { addonPrice: p.addonPrice } : {}),
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
