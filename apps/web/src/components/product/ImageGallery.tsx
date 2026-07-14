"use client"

import { useState } from "react"
import Image from "next/image"

export function ImageGallery({
  images,
  productName,
}: {
  images: string[]
  productName: string
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Handle empty or missing images
  if (!images || images.length === 0) {
    return (
      <div className="aspect-square w-full rounded-[10px] bg-[#f5f5f5] flex items-center justify-center">
        <span className="text-gray-400 text-sm">暫無圖片</span>
      </div>
    )
  }

  const mainSrc = images[selectedIndex] ?? images[0]

  return (
    <div className="flex w-full flex-col gap-3">
      {/* Main image */}
      <div className="relative aspect-square w-full overflow-hidden rounded-[10px] bg-[#f5f5f5]">
        <Image
          src={mainSrc}
          alt={productName}
          fill
          sizes="(max-width: 768px) 100vw, 50vw"
          className="object-contain"
          priority
          unoptimized
        />
      </div>

      {/* Thumbnails – only show when more than 1 image */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((src, index) => (
            <button
              key={src + index}
              type="button"
              onClick={() => setSelectedIndex(index)}
              className={`relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-[10px] bg-[#f5f5f5] border-2 transition-colors ${
                index === selectedIndex
                  ? "border-[#10305a]"
                  : "border-transparent hover:border-gray-300"
              }`}
            >
              <Image
                src={src}
                alt={`${productName} ${index + 1}`}
                fill
                sizes="64px"
                className="object-contain"
                unoptimized
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
