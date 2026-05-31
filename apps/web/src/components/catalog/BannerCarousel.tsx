"use client"

import { useState, useEffect, useCallback } from "react"
import Image from "next/image"

interface BannerCarouselProps {
  images: { src: string; alt: string }[]
  autoPlayInterval?: number
}

export function BannerCarousel({ images, autoPlayInterval = 4000 }: BannerCarouselProps) {
  const [current, setCurrent] = useState(0)

  const next = useCallback(() => {
    setCurrent((c) => (c + 1) % images.length)
  }, [images.length])

  const prev = useCallback(() => {
    setCurrent((c) => (c - 1 + images.length) % images.length)
  }, [images.length])

  useEffect(() => {
    const timer = setInterval(next, autoPlayInterval)
    return () => clearInterval(timer)
  }, [next, autoPlayInterval])

  if (!images.length) return null

  return (
    <div className="relative w-full overflow-hidden rounded-[10px] mb-10 select-none">
      {/* Slides */}
      <div
        className="flex transition-transform duration-700 ease-in-out"
        style={{ transform: `translateX(-${current * 100}%)` }}
      >
        {images.map((img, i) => (
          <div key={i} className="min-w-full">
            <Image
              src={img.src}
              alt={img.alt}
              width={1200}
              height={800}
              className="w-full h-auto block"
              priority={i === 0}
            />
          </div>
        ))}
      </div>

      {/* Prev / Next arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="上一張"
            className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-white/70 hover:bg-white transition-colors shadow"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10305a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            onClick={next}
            aria-label="下一張"
            className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-full bg-white/70 hover:bg-white transition-colors shadow"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10305a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* Dot indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`第 ${i + 1} 張`}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === current ? "bg-[#10305a]" : "bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
