"use client"
import Image from "next/image"
import Link from "next/link"
import type { Product } from "@/lib/catalog"

export function ProductCard({
  product,
}: {
  product: Product
  categoryName?: string
}) {
  const image = product.images?.[0]
  const isSoldOut = product.total_stock === 0
  const minPrice = product.min_price
  const maxPrice = product.max_price
  const minSalePrice = product.min_sale_price
  const hasDiscount = minSalePrice != null && minPrice != null && minSalePrice < minPrice
  const hasRange = minPrice != null && maxPrice != null && minPrice !== maxPrice
  const isVariable = hasRange

  return (
    <div
      className="flex flex-col h-full bg-white overflow-hidden"
      style={{ boxShadow: "2px 2px 6px 0 rgba(0,0,0,.15)" }}
    >
      {/* Image */}
      <Link href={`/shop/${product.slug}`} className="block overflow-hidden">
        <div className="aspect-square relative bg-zinc-50 overflow-hidden group">
          {image ? (
            <Image
              src={image}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">
              無圖片
            </div>
          )}

          {/* Sale badge */}
          {hasDiscount && (
            <div
              className="absolute top-2 left-2 px-2 py-0.5 text-xs font-bold text-white"
              style={{ backgroundColor: "#f59e0b" }}
            >
              優惠
            </div>
          )}

          {/* Member-exclusive badge */}
          {product.min_tier && (
            <div
              className="absolute top-2 right-2 px-2 py-0.5 text-xs font-bold text-white"
              style={{ backgroundColor: "#10305a" }}
            >
              {product.min_tier.name}限定
            </div>
          )}

          {/* Sold out overlay */}
          {isSoldOut && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="text-white text-sm font-semibold px-3 py-1 bg-red-600">
                已售完
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* Content */}
      <div className="flex flex-col flex-1 pt-3 pb-3 px-3 gap-2">
        {/* Product name */}
        <Link href={`/shop/${product.slug}`}>
          <p
            className="text-sm font-medium leading-snug line-clamp-2 hover:underline"
            style={{ color: "#10305a" }}
          >
            {product.name}
          </p>
        </Link>

        {/* Star rating - always 5 stars like WP site */}
        <div className="flex items-center gap-0.5" style={{ color: "#f59e0b" }}>
          {[1,2,3,4,5].map(i => (
            <span key={i} className="text-xs leading-none">★</span>
          ))}
        </div>

        {/* Price */}
        {minPrice != null && minPrice > 0 && (
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {hasDiscount ? (
              <>
                <span className="text-xs line-through" style={{ color: "#687279" }}>
                  NT${minPrice.toLocaleString()}
                </span>
                <span className="text-sm font-bold" style={{ color: "#10305a" }}>
                  NT${minSalePrice!.toLocaleString()}
                </span>
              </>
            ) : hasRange ? (
              <>
                <span className="text-sm font-bold" style={{ color: "#10305a" }}>
                  NT${minPrice.toLocaleString()}
                </span>
                <span className="text-xs" style={{ color: "#687279" }}>
                  – NT${maxPrice!.toLocaleString()}
                </span>
              </>
            ) : (
              <span className="text-sm font-bold" style={{ color: "#10305a" }}>
                NT${minPrice.toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action button */}
        {!isSoldOut ? (
          <div className="mt-1">
            {isVariable ? (
              <Link
                href={`/shop/${product.slug}`}
                className="block w-full text-center text-xs font-semibold py-2.5 border transition-colors hover:bg-zinc-50"
                style={{
                  color: "#10305a",
                  borderColor: "#10305a",
                }}
              >
                選擇規格
              </Link>
            ) : (
              <Link
                href={`/shop/${product.slug}`}
                className="block w-full text-center text-xs font-semibold py-2.5 text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#10305a" }}
              >
                加入購物車
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-1">
            <div
              className="block w-full text-center text-xs font-semibold py-2.5 text-white opacity-50 cursor-not-allowed"
              style={{ backgroundColor: "#687279" }}
            >
              已售完
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
