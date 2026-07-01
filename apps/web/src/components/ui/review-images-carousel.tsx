"use client"

import Image from "next/image"
import { useState, useEffect, useRef } from "react"
import { ChevronLeft, ChevronRight, Play } from "lucide-react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

export type CarouselItem = {
  type: "image" | "video"
  src: string
  alt: string
}

const DEFAULT_ITEMS: CarouselItem[] = [
  { type: "video", src: "/brand/review-video.mov", alt: "顧客回饋影片" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/de270008bc4f78af80171e0161e91614.jpg", alt: "顧客回饋 1" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/d0313c0a4128ab049d472fe47492b856.jpg", alt: "顧客回饋 2" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/f57273957d46814a4ea2f8b9f184d19d.jpg", alt: "顧客回饋 3" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/6de0d35141b2593217969fcdf0f38ffb.jpg", alt: "顧客回饋 4" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/af4caa33891c6ea045be1fd0e011e93c.jpg", alt: "顧客回饋 5" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/6994188db63c723bf347ee6c4f11435f.jpg", alt: "顧客回饋 6" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/f6ed8d57e5e88c1948fd1cfe31fcc8dc.jpg", alt: "顧客回饋 7" },
  { type: "image", src: "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/product-images/legacy-wp/c63e2a3af7142e9223a112a52515eafb.jpg", alt: "顧客回饋 8" },
]

const ITEMS_PER_PAGE = 4

function VideoItem({ src, alt }: { src: string; alt: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  function toggle() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  return (
    <div className="relative w-full h-full cursor-pointer group" onClick={toggle}>
      <video
        ref={videoRef}
        src={src}
        playsInline
        loop
        muted={false}
        className="w-full h-full object-cover"
        onEnded={() => setPlaying(false)}
      />
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <Play className="w-5 h-5 text-[#10305a] fill-[#10305a] ml-0.5" />
          </div>
        </div>
      )}
    </div>
  )
}

export function ReviewImagesCarousel() {
  const [items, setItems] = useState<CarouselItem[]>(DEFAULT_ITEMS)
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetch(`${API_URL}/site-contents/review_carousel`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        const arr = json?.data
        if (Array.isArray(arr) && arr.length > 0) setItems(arr)
      })
      .catch(() => {})
  }, [])

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE)
  const visible = items.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE)

  // Reset page if items change
  useEffect(() => { setPage(0) }, [items.length])

  return (
    <div className="mt-10">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {visible.map((item, i) => (
          <div key={`${item.src}-${i}`} className="overflow-hidden rounded-[10px] shadow-sm aspect-[9/16] bg-gray-100">
            {item.type === "video" ? (
              <VideoItem src={item.src} alt={item.alt} />
            ) : (
              <Image
                src={item.src}
                alt={item.alt}
                width={576}
                height={1024}
                className="w-full h-full object-cover"
                unoptimized
              />
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center justify-center w-9 h-9 rounded-full border border-[#10305a] text-[#10305a] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#10305a] hover:text-white transition-colors"
            aria-label="上一頁"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="flex gap-2">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${i === page ? "bg-[#10305a]" : "bg-[#10305a]/25"}`}
                aria-label={`第 ${i + 1} 頁`}
              />
            ))}
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1}
            className="flex items-center justify-center w-9 h-9 rounded-full border border-[#10305a] text-[#10305a] disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#10305a] hover:text-white transition-colors"
            aria-label="下一頁"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  )
}
