"use client"

import Link from "next/link"
import Image from "next/image"
import { useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { Post } from "@/lib/content"

export function TestimonialsCarousel({ posts }: { posts: Post[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  if (!posts.length) {
    return (
      <p className="mt-8 text-center text-sm text-zinc-400">見證故事陸續更新中，敬請期待。</p>
    )
  }

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current
    if (!el) return
    const card = el.querySelector("a") as HTMLElement | null
    const cardW = card ? card.offsetWidth + 16 : 300
    el.scrollBy({ left: dir === "left" ? -cardW : cardW, behavior: "smooth" })
  }

  return (
    <div className="mt-8">
      <div className="relative">
        {/* Prev */}
        <button
          onClick={() => scroll("left")}
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 hidden sm:flex w-9 h-9 items-center justify-center rounded-full bg-white shadow-md border border-gray-100 text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
          aria-label="上一則"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Scroll track */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden pb-1"
          style={{ scrollbarWidth: "none" }}
        >
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="group snap-start shrink-0 w-[calc(50%-8px)] sm:w-[calc(25%-12px)]"
            >
              <div className="relative overflow-hidden rounded-2xl shadow-md hover:shadow-xl transition-shadow aspect-[3/4] bg-gradient-to-br from-[#f5f0fa] to-[#faf6f2]">
                {post.cover_image ? (
                  <Image
                    src={post.cover_image}
                    alt={post.title}
                    fill
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[#10305a]/20 text-3xl">
                    💬
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <p className="text-white text-sm font-semibold line-clamp-3 leading-snug">
                    {post.title}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Next */}
        <button
          onClick={() => scroll("right")}
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 hidden sm:flex w-9 h-9 items-center justify-center rounded-full bg-white shadow-md border border-gray-100 text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
          aria-label="下一則"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="mt-7 text-center">
        <Button
          asChild
          variant="outline"
          size="lg"
          className="rounded-[10px] border-[#10305a]/30 text-[#10305a] hover:bg-[#10305a]/5 px-8"
        >
          <Link href="/testimonials">查看更多見證 →</Link>
        </Button>
      </div>
    </div>
  )
}
