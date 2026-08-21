"use client"

import { useState, useEffect } from "react"
import { Minus, Plus, PencilLine, ShoppingCart } from "lucide-react"
import { useCart } from "@/lib/cart"
import { Badge } from "@/components/ui/badge"
import { AddonStrip } from "./AddonStrip"

type Variant = {
  id: string
  name: string
  price: string
  sale_price: string | null
  stock_qty: number
}

export function AddToCartSection({
  productName,
  variants,
  imageUrl,
  minTierName,
  userQualifies = true,
  variantNote,
}: {
  productName: string
  variants: Variant[]
  imageUrl?: string
  minTierName?: string
  userQualifies?: boolean
  variantNote?: string
}) {
  const [selectedVariantId, setSelectedVariantId] = useState<string>(
    variants[0]?.id ?? ""
  )
  const [qty, setQty] = useState(1)
  const addItem = useCart((s) => s.addItem)
  const updatePrice = useCart((s) => s.updatePrice)
  const cartItems = useCart((s) => s.items)

  useEffect(() => {
    for (const v of variants) {
      const ep = Number(v.sale_price ?? v.price)
      const op = Number(v.price)
      const item = cartItems.find((i) => i.variantId === v.id)
      if (item && (item.price !== ep || item.originalPrice !== op)) updatePrice(v.id, ep, op)
    }
  }, [variants, cartItems, updatePrice])

  const selected = variants.find((v) => v.id === selectedVariantId)
  const price = selected
    ? Number(selected.sale_price ?? selected.price)
    : 0
  const originalPrice = selected ? Number(selected.price) : 0
  const hasDiscount = selected?.sale_price && Number(selected.sale_price) < originalPrice
  const outOfStock = selected?.stock_qty === 0

  function handleAdd() {
    if (!selected || outOfStock) return
    addItem({
      variantId: selected.id,
      productName,
      variantName: selected.name,
      price,
      originalPrice: Number(selected.price),
      qty,
      stockQty: selected.stock_qty ?? undefined,
      imageUrl,
    })
    setQty(1)
  }

  const tierLocked = !!minTierName && !userQualifies

  return (
    <div className="space-y-5">
      {/* Tier restriction notice */}
      {tierLocked && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm" style={{ color: "#92400e" }}>
          此商品限 <strong>{minTierName}</strong> 以上會員購買
        </div>
      )}

      {/* Variant selector */}
      <div className="space-y-2">
        <p className="text-sm font-medium" style={{ color: "#687279" }}>規格</p>
        <div className="flex flex-wrap gap-2">
          {variants.map((v) => {
            const isSelected = v.id === selectedVariantId
            const isOut = v.stock_qty === 0
            return (
              <button
                key={v.id}
                type="button"
                disabled={isOut}
                onClick={() => {
                  setSelectedVariantId(v.id)
                  setQty(1)
                }}
                className={`rounded-lg border px-4 py-2.5 text-sm transition-colors ${
                  isSelected
                    ? "border-[#10305a] bg-[#10305a]/5 font-medium text-[#10305a]"
                    : "border-gray-200 hover:border-[#10305a]/50"
                } ${isOut ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
              >
                {v.name}
                {isOut && (
                  <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">
                    缺貨
                  </Badge>
                )}
              </button>
            )
          })}
        </div>
        {variantNote && (
          <p
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-center"
            style={{ color: "#10305a" }}
          >
            <PencilLine className="h-3.5 w-3.5 shrink-0" />
            {variantNote}
          </p>
        )}
      </div>

      {/* Price display */}
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold" style={{ color: "#10305a" }}>
          NT$ {price.toLocaleString()}
        </span>
        {hasDiscount && (
          <span className="text-base line-through" style={{ color: "#687279" }}>
            NT$ {originalPrice.toLocaleString()}
          </span>
        )}
      </div>

      {/* Quantity selector + Add to cart */}
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg border">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center hover:bg-accent transition-colors rounded-l-lg"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="減少數量"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="flex h-10 w-12 items-center justify-center text-sm font-medium tabular-nums border-x">
            {qty}
          </span>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center hover:bg-accent transition-colors rounded-r-lg"
            onClick={() => setQty((q) => q + 1)}
            aria-label="增加數量"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          className="flex-1 h-10 gap-2 inline-flex items-center justify-center text-sm font-medium text-white rounded-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: "#10305a" }}
          onClick={handleAdd}
          disabled={outOfStock || tierLocked}
        >
          <ShoppingCart className="h-4 w-4" />
          {outOfStock ? "目前缺貨" : tierLocked ? "會員限定商品" : "加入購物車"}
        </button>
      </div>

      <AddonStrip
        excludeVariantIds={variants.map((v) => v.id)}
        limit={6}
        title="加購區"
      />
    </div>
  )
}
