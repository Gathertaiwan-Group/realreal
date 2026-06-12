"use client"

import { useState, useCallback } from "react"

interface ExplainCarouselProps {
  images: { src: string; alt: string }[]
}

export function ExplainCarousel({ images }: ExplainCarouselProps) {
  const [current, setCurrent] = useState(0)

  const prev = useCallback(() =>
    setCurrent((c) => (c - 1 + images.length) % images.length), [images.length])
  const next = useCallback(() =>
    setCurrent((c) => (c + 1) % images.length), [images.length])

  if (!images.length) return null

  return (
    <div className="mb-10">
      <div className="relative mx-auto max-w-sm">
        {/* Slide */}
        <div className="overflow-hidden rounded-2xl shadow-sm">
          <img
            key={current}
            src={images[current].src}
            alt={images[current].alt}
            className="w-full h-auto block"
          />
        </div>

        {/* Prev */}
        <button
          onClick={prev}
          aria-label="上一張"
          className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 hover:bg-white shadow flex items-center justify-center text-[#10305a] transition-colors"
        >
          &#8249;
        </button>

        {/* Next */}
        <button
          onClick={next}
          aria-label="下一張"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/80 hover:bg-white shadow flex items-center justify-center text-[#10305a] transition-colors"
        >
          &#8250;
        </button>

        {/* Counter */}
        <p className="text-center text-sm text-[#a09080] mt-3">
          {current + 1} / {images.length}
        </p>

        {/* Dots */}
        <div className="flex justify-center gap-1.5 mt-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`第 ${i + 1} 張`}
              className="w-1.5 h-1.5 rounded-full transition-colors"
              style={{ backgroundColor: i === current ? "#10305a" : "#d1cdc7" }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
