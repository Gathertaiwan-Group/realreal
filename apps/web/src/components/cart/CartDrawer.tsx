"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useState } from "react"
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react"
import { useCart } from "@/lib/cart"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"

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

  const subtotal = hydrated ? total() : 0
  const cartItems = hydrated ? items : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col">
        <SheetHeader>
          <SheetTitle>購物車</SheetTitle>
        </SheetHeader>

        {cartItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <ShoppingBag className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">購物車是空的</p>
            <Button asChild variant="outline" onClick={() => onOpenChange(false)}>
              <Link href="/shop">去逛逛</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-[200px] overflow-y-auto px-6 py-4">
              <ul className="space-y-4">
                {cartItems.map((item) => {
                  const name = item.productName || "商品"
                  const variant = item.variantName || ""
                  // Older next/image with an off-whitelist remote URL throws
                  // at the optimisation step and can take down the whole
                  // <ul>. Fall back to a plain <img> for any host the
                  // Vercel image config doesn't recognise.
                  const safeImage =
                    !!item.imageUrl &&
                    (item.imageUrl.startsWith("/") ||
                      item.imageUrl.includes("realreal-store.vercel.app") ||
                      item.imageUrl.includes("realreal.cc"))
                  return (
                  <li
                    key={item.variantId}
                    className="flex gap-3 rounded-[10px] border p-3 bg-background"
                  >
                    {safeImage ? (
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-zinc-100">
                        <Image
                          src={item.imageUrl as string}
                          alt={name}
                          fill
                          sizes="64px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    ) : item.imageUrl ? (
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-zinc-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.imageUrl}
                          alt={name}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[10px] bg-zinc-100 text-xs text-zinc-400">
                        無圖
                      </div>
                    )}

                    <div className="flex flex-1 flex-col justify-between">
                      <div>
                        <p className="text-sm font-medium leading-tight">
                          {name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {variant}
                        </p>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-[10px] border text-sm hover:bg-accent transition-colors"
                            onClick={() =>
                              updateQty(item.variantId, item.qty - 1)
                            }
                            aria-label="減少數量"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center text-sm tabular-nums">
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-[10px] border text-sm hover:bg-accent transition-colors"
                            onClick={() =>
                              updateQty(item.variantId, item.qty + 1)
                            }
                            aria-label="增加數量"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            NT$ {(item.price * item.qty).toLocaleString()}
                          </span>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-[10px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            onClick={() => removeItem(item.variantId)}
                            aria-label={`移除 ${item.productName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </li>
                )
                })}
              </ul>
            </div>

            <SheetFooter className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-base font-semibold">
                <span>小計</span>
                <span>NT$ {subtotal.toLocaleString()}</span>
              </div>
              <Button asChild className="w-full rounded-[10px] bg-[#10305a] text-white hover:bg-[#10305a]/90" onClick={() => onOpenChange(false)}>
                <Link href="/checkout">前往結帳</Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
