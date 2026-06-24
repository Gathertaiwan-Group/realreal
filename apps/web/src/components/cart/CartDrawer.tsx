"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { Minus, Plus, Trash2, ShoppingBag, Truck, Check } from "lucide-react"
import { useCart } from "@/lib/cart"
import { fetchRecommendations, type RecommendedProduct } from "@/lib/cart-recommendations"
import { API_URL } from "@/lib/api-url"
import { applyAddonDisplay, cartDisplaySubtotal, type AddonDisplayLine } from "@/lib/addon-display"
import {
  buildOrderPreviewItems,
  getFreeShippingProgress,
  type OrderPreviewData,
} from "@/lib/shipping-preview"
import { Button } from "@/components/ui/button"
import { AddonStrip } from "@/components/product/AddonStrip"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"

function FreeShippingBar({
  subtotal,
  threshold,
  loading,
}: {
  subtotal: number
  threshold: number | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="px-6 py-3 border-b bg-zinc-50/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Truck className="h-4 w-4 shrink-0" />
          <p>宅配免運門檻計算中…</p>
        </div>
      </div>
    )
  }

  const progress = threshold == null
    ? null
    : getFreeShippingProgress({ subtotal, threshold })
  if (!progress?.enabled) {
    return (
      <div className="px-6 py-3 border-b bg-zinc-50/50 shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Truck className="h-4 w-4 shrink-0" />
          <p>運費將於結帳時計算</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 py-3 border-b bg-zinc-50/50 shrink-0">
      <div className="flex items-center gap-2 text-xs">
        {progress.reached ? (
          <>
            <Check className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-green-700 font-medium">已達宅配免運門檻</p>
          </>
        ) : (
          <>
            <Truck className="h-4 w-4 text-[#10305a] shrink-0" />
            <p className="text-[#10305a]">
              再買 <span className="font-semibold">NT$ {progress.remaining.toLocaleString()}</span> 享宅配免運
            </p>
          </>
        )}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
        <div
          className={`h-full transition-all duration-300 ${progress.reached ? "bg-green-500" : "bg-[#10305a]"}`}
          style={{ width: `${progress.pct}%` }}
        />
      </div>
    </div>
  )
}

function SafeProductImage({
  src,
  alt,
  size,
}: {
  src?: string
  alt: string
  size: number
}) {
  const safe =
    !!src &&
    (src.startsWith("/") ||
      src.includes("realreal-store.vercel.app") ||
      src.includes("realreal.cc"))
  if (!src) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-[10px] bg-zinc-100 text-xs text-zinc-400"
        style={{ width: size, height: size }}
      >
        無圖
      </div>
    )
  }
  if (safe) {
    return (
      <div
        className="relative shrink-0 overflow-hidden rounded-[10px] bg-zinc-100"
        style={{ width: size, height: size }}
      >
        <Image src={src} alt={alt} fill sizes={`${size}px`} className="object-cover" unoptimized />
      </div>
    )
  }
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-[10px] bg-zinc-100"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" />
    </div>
  )
}

function CartItemRow({
  item,
  addonLine,
  onUpdateQty,
  onRemove,
}: {
  item: ReturnType<typeof useCart.getState>["items"][number]
  // DISPLAY-only add-on pricing for this line (server is authoritative).
  addonLine: AddonDisplayLine
  onUpdateQty: (variantId: string, qty: number) => void
  onRemove: (variantId: string) => void
}) {
  const name = item.productName || "商品"
  const variant = item.variantName && item.variantName !== "預設" ? item.variantName : ""
  const atStockCap = item.stockQty != null && item.qty >= item.stockQty
  // Original (non-discounted) line total, shown struck-through when the
  // 加購價 discount applies to the first unit.
  const originalLineTotal = item.price * item.qty
  return (
    <li className="flex gap-4 rounded-[10px] border p-3 bg-background">
      <SafeProductImage src={item.imageUrl} alt={name} size={96} />
      <div className="flex flex-1 min-w-0 flex-col justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug line-clamp-2 text-[#10305a]">{name}</p>
          {variant && (
            <p className="mt-0.5 text-xs text-muted-foreground">規格：{variant}</p>
          )}
          {atStockCap && (
            <p className="mt-0.5 text-[11px] text-amber-600">✓ 已是庫存上限</p>
          )}
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-[10px] border text-sm hover:bg-accent transition-colors"
              onClick={() => onUpdateQty(item.variantId, item.qty - 1)}
              aria-label="減少數量"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-8 text-center text-sm tabular-nums">{item.qty}</span>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-[10px] border text-sm hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              onClick={() => onUpdateQty(item.variantId, item.qty + 1)}
              disabled={atStockCap}
              aria-label="增加數量"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {addonLine.addonApplied ? (
              <span className="flex flex-col items-end leading-tight">
                <span className="flex items-center gap-1">
                  <span className="rounded bg-[#10305a]/10 px-1 py-0.5 text-[10px] font-medium text-[#10305a]">
                    加購價
                  </span>
                  <span className="text-sm font-semibold text-[#10305a]">
                    NT$ {addonLine.lineSubtotal.toLocaleString()}
                  </span>
                </span>
                <span className="text-[11px] text-zinc-400 line-through">
                  NT$ {originalLineTotal.toLocaleString()}
                </span>
              </span>
            ) : (
              <span className="text-sm font-semibold text-[#10305a]">
                NT$ {originalLineTotal.toLocaleString()}
              </span>
            )}
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              onClick={() => onRemove(item.variantId)}
              aria-label={`移除 ${name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

function RecommendationStrip({
  excludeVariantIds,
}: {
  excludeVariantIds: string[]
}) {
  const [recommended, setRecommended] = useState<RecommendedProduct[]>([])
  const addItem = useCart((s) => s.addItem)

  useEffect(() => {
    let cancelled = false
    fetchRecommendations(excludeVariantIds, 4).then((r) => {
      if (!cancelled) setRecommended(r)
    })
    return () => {
      cancelled = true
    }
    // We intentionally don't re-fetch on every excludeVariantIds change to
    // avoid hammering the API every time the user clicks "+ 加". The list
    // is loaded once when the cart opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (recommended.length === 0) return null

  return (
    <div className="border-t px-6 py-4 bg-zinc-50/30">
      <p className="text-xs font-medium text-[#10305a] mb-3">💡 你也可能喜歡</p>
      <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1 scrollbar-thin">
        {recommended.map((p) => (
          <div
            key={p.id}
            className="flex shrink-0 w-[150px] flex-col gap-2 rounded-[10px] border bg-background p-2"
          >
            <Link href={`/shop/${p.slug}`} className="block">
              <SafeProductImage src={p.imageUrl} alt={p.name} size={134} />
            </Link>
            <Link href={`/shop/${p.slug}`} className="block min-h-[2.5rem]">
              <p className="text-xs font-medium leading-snug line-clamp-2 text-[#10305a]">{p.name}</p>
            </Link>
            <div className="flex items-center justify-between gap-1">
              {p.salePrice != null ? (
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="text-xs font-semibold text-[#10305a]">
                    NT$ {p.salePrice.toLocaleString()}
                  </span>
                  <span className="text-[10px] text-zinc-400 line-through">
                    NT$ {p.price.toLocaleString()}
                  </span>
                </span>
              ) : (
                <span className="text-xs font-semibold text-[#10305a]">NT$ {p.price.toLocaleString()}</span>
              )}
              <button
                type="button"
                className="flex h-7 shrink-0 items-center gap-0.5 rounded-[10px] border border-[#10305a] px-2 text-xs font-medium text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
                onClick={() =>
                  addItem({
                    variantId: p.variantId,
                    productName: p.name,
                    variantName: p.variantName,
                    price: p.salePrice ?? p.price,
                    originalPrice: p.price,
                    qty: 1,
                    stockQty: p.stockQty,
                    imageUrl: p.imageUrl,
                  })
                }
                aria-label={`加入 ${p.name}`}
              >
                <Plus className="h-3 w-3" /> 加
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function CartDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const items = useCart((s) => s.items)
  const removeItem = useCart((s) => s.removeItem)
  const updateQty = useCart((s) => s.updateQty)
  const total = useCart((s) => s.total)
  const [hydrated, setHydrated] = useState(false)
  const [homePreview, setHomePreview] = useState<OrderPreviewData | null>(null)
  const [homePreviewLoading, setHomePreviewLoading] = useState(false)

  useEffect(() => {
    useCart.persist.rehydrate()
    setHydrated(true)
  }, [])

  const cartItems = useMemo(() => hydrated ? items : [], [hydrated, items])
  // DISPLAY-only add-on pricing: apply the 加購價 rule per line so the drawer
  // shows the discounted first unit. The server (/orders/preview) remains the
  // authoritative price; total() from the store is the plain (pre-add-on) sum.
  const addonLines = useMemo(() => applyAddonDisplay(cartItems), [cartItems])
  const subtotal = hydrated ? cartDisplaySubtotal(cartItems) : 0
  const itemCount = cartItems.reduce((sum, i) => sum + i.qty, 0)
  // Plain pre-discount sum — only surfaced (struck-through) when it differs.
  const plainSubtotal = hydrated ? total() : 0

  const excludeIds = useMemo(() => cartItems.map((i) => i.variantId), [cartItems])
  const itemsKey = useMemo(
    () => cartItems.map((item) => `${item.variantId}:${item.qty}:${item.price}`).sort().join("|"),
    [cartItems],
  )

  useEffect(() => {
    if (!hydrated || cartItems.length === 0) {
      setHomePreview(null)
      setHomePreviewLoading(false)
      return
    }

    setHomePreview(null)
    setHomePreviewLoading(true)
    const timeout = setTimeout(async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client")
        const supabase = createClient()
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        const res = await fetch(`${API_URL}/orders/preview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            items: buildOrderPreviewItems(cartItems),
            shippingMethod: "home_delivery",
          }),
        })
        if (!res.ok) {
          setHomePreview(null)
          return
        }
        const json = await res.json()
        setHomePreview(json.data ?? null)
      } catch {
        setHomePreview(null)
      } finally {
        setHomePreviewLoading(false)
      }
    }, 250)

    return () => {
      clearTimeout(timeout)
      setHomePreviewLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, itemsKey])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col p-0">
        {/* Header — sticky, no padding override (Sheet uses p-0 now) */}
        <SheetHeader className="px-6 py-4 pb-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-lg text-[#10305a]">
            <ShoppingBag className="h-5 w-5" />
            購物車
            {itemCount > 0 && (
              <span className="text-base font-normal text-muted-foreground">({itemCount})</span>
            )}
          </SheetTitle>
        </SheetHeader>

        {cartItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center px-6">
            <ShoppingBag className="h-16 w-16 text-zinc-300" />
            <p className="text-muted-foreground">購物車是空的</p>
            <Button asChild variant="outline" onClick={() => onOpenChange(false)}>
              <Link href="/shop">去逛逛</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Free shipping progress (just below header) */}
            <FreeShippingBar
              subtotal={subtotal}
              threshold={homePreview?.shipping_rule?.free_threshold ?? null}
              loading={homePreviewLoading}
            />

            {/* Items + recommendations share ONE shrinkable scroll region so the
                footer (繼續購物 / 前往結帳) stays pinned and on-screen at any
                viewport height. min-h-0 lets this region shrink below its content;
                without it the flex column overflows and pushes the footer off. */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="px-6 py-4">
                <ul className="space-y-3">
                  {cartItems.map((item, i) => (
                    <CartItemRow
                      key={item.variantId}
                      item={item}
                      addonLine={addonLines[i]}
                      onUpdateQty={updateQty}
                      onRemove={removeItem}
                    />
                  ))}
                </ul>
              </div>

              {/* 加購商品（限量加購價）— 放在「你也可能喜歡」上方 */}
              <AddonStrip
                excludeVariantIds={excludeIds}
                limit={8}
                title="🛍️ 加購商品"
                notice="🌟 此區為限量加購，敬請把握機會 🌟"
                onlyAddon
                highlight
              />

              {/* Recommendations now scroll together with the items */}
              <RecommendationStrip excludeVariantIds={excludeIds} />
            </div>

            {/* Footer — totals + CTAs, sticky bottom */}
            <SheetFooter className="flex-col gap-3 border-t bg-background px-6 py-4 shrink-0">
              <div className="flex w-full items-center justify-between text-base">
                <span className="font-medium">
                  小計 <span className="text-xs text-muted-foreground">（{itemCount} 件）</span>
                </span>
                <span className="flex items-baseline gap-2">
                  {subtotal < plainSubtotal && (
                    <span className="text-sm text-zinc-400 line-through">
                      NT$ {plainSubtotal.toLocaleString()}
                    </span>
                  )}
                  <span className="text-lg font-semibold text-[#10305a]">
                    NT$ {subtotal.toLocaleString()}
                  </span>
                </span>
              </div>
              <p className="-mt-2 w-full text-xs text-muted-foreground">
                {subtotal < plainSubtotal ? "已含加購價優惠，運費將於結帳時計算" : "運費將於結帳時計算"}
              </p>

              <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2">
                <Button
                  variant="outline"
                  className="h-12 rounded-[10px] border-[#10305a] text-[#10305a] hover:bg-[#10305a]/5 md:order-1 order-2"
                  onClick={() => onOpenChange(false)}
                >
                  繼續購物
                </Button>
                <Button
                  asChild
                  className="h-12 rounded-[10px] bg-[#10305a] text-white hover:bg-[#10305a]/90 md:order-2 order-1"
                  onClick={() => onOpenChange(false)}
                >
                  <Link href="/checkout">前往結帳</Link>
                </Button>
              </div>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
