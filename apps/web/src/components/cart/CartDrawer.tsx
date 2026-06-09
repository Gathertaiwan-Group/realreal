"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useMemo, useState } from "react"
import { Minus, Plus, Trash2, ShoppingBag, Truck, Check } from "lucide-react"
import { useCart } from "@/lib/cart"
import { fetchRecommendations, type RecommendedProduct } from "@/lib/cart-recommendations"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"

const FREE_SHIPPING_THRESHOLD = 1499

function FreeShippingBar({ subtotal }: { subtotal: number }) {
  const reached = subtotal >= FREE_SHIPPING_THRESHOLD
  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal)
  const pct = Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD) * 100))
  return (
    <div className="px-6 py-3 border-b bg-zinc-50/50">
      <div className="flex items-center gap-2 text-xs">
        {reached ? (
          <>
            <Check className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-green-700 font-medium">已達宅配免運門檻</p>
          </>
        ) : (
          <>
            <Truck className="h-4 w-4 text-[#10305a] shrink-0" />
            <p className="text-[#10305a]">
              再買 <span className="font-semibold">NT$ {remaining.toLocaleString()}</span> 享宅配免運
            </p>
          </>
        )}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
        <div
          className={`h-full transition-all duration-300 ${reached ? "bg-green-500" : "bg-[#10305a]"}`}
          style={{ width: `${pct}%` }}
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
  onUpdateQty,
  onRemove,
}: {
  item: ReturnType<typeof useCart.getState>["items"][number]
  onUpdateQty: (variantId: string, qty: number) => void
  onRemove: (variantId: string) => void
}) {
  const name = item.productName || "商品"
  const variant = item.variantName && item.variantName !== "預設" ? item.variantName : ""
  const atStockCap = item.stockQty != null && item.qty >= item.stockQty
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
            <span className="text-sm font-semibold text-[#10305a]">
              NT$ {(item.price * item.qty).toLocaleString()}
            </span>
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
              <span className="text-xs font-semibold text-[#10305a]">NT$ {p.price.toLocaleString()}</span>
              <button
                type="button"
                className="flex h-7 items-center gap-0.5 rounded-[10px] border border-[#10305a] px-2 text-xs font-medium text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
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

  useEffect(() => {
    useCart.persist.rehydrate()
    setHydrated(true)
  }, [])

  const cartItems = hydrated ? items : []
  const subtotal = hydrated ? total() : 0
  const itemCount = cartItems.reduce((sum, i) => sum + i.qty, 0)

  const excludeIds = useMemo(() => cartItems.map((i) => i.variantId), [cartItems])

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
            <FreeShippingBar subtotal={subtotal} />

            {/* Items — scrollable, fills remaining space */}
            <div className="flex-1 min-h-[180px] overflow-y-auto px-6 py-4">
              <ul className="space-y-3">
                {cartItems.map((item) => (
                  <CartItemRow
                    key={item.variantId}
                    item={item}
                    onUpdateQty={updateQty}
                    onRemove={removeItem}
                  />
                ))}
              </ul>
            </div>

            {/* Recommendations strip (between items and footer) */}
            <RecommendationStrip excludeVariantIds={excludeIds} />

            {/* Footer — totals + CTAs, sticky bottom */}
            <SheetFooter className="flex-col gap-3 border-t bg-background px-6 py-4 shrink-0">
              <div className="flex w-full items-center justify-between text-base">
                <span className="font-medium">
                  小計 <span className="text-xs text-muted-foreground">（{itemCount} 件）</span>
                </span>
                <span className="text-lg font-semibold text-[#10305a]">
                  NT$ {subtotal.toLocaleString()}
                </span>
              </div>
              <p className="-mt-2 w-full text-xs text-muted-foreground">運費將於結帳時計算</p>

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
