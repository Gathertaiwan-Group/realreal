"use client"

import { useState, useEffect, useCallback } from "react"

interface Slide {
  src: string
  alt: string
  title: string
  body: string[]   // each string = one paragraph
}

interface BannerCarouselProps {
  slides: Slide[]
  autoPlayInterval?: number
}

export function BannerCarousel({ slides, autoPlayInterval = 5000 }: BannerCarouselProps) {
  const [current, setCurrent] = useState(0)
  const [animating, setAnimating] = useState(false)

  const goTo = useCallback((idx: number) => {
    if (animating) return
    setAnimating(true)
    setCurrent(idx)
    setTimeout(() => setAnimating(false), 700)
  }, [animating])

  const next = useCallback(() => goTo((current + 1) % slides.length), [current, slides.length, goTo])
  const prev = useCallback(() => goTo((current - 1 + slides.length) % slides.length), [current, slides.length, goTo])

  useEffect(() => {
    const timer = setInterval(next, autoPlayInterval)
    return () => clearInterval(timer)
  }, [next, autoPlayInterval])

  if (!slides.length) return null

  return (
    <div className="relative w-full overflow-hidden mb-10" style={{ aspectRatio: "16/5" }}>
      {/* Slides */}
      {slides.map((slide, i) => (
        <div
          key={i}
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: i === current ? 1 : 0, pointerEvents: i === current ? "auto" : "none" }}
        >
          {/* Background image */}
          <img
            src={slide.src}
            alt={slide.alt}
            className="w-full h-full object-cover"
          />
          {/* Dark scrim */}
          <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.38)" }} />
          {/* Text overlay — centered */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-white">
            <h2
              className="font-bold mb-3 leading-tight"
              style={{ fontSize: "clamp(1.4rem, 2.8vw, 2.2rem)", textShadow: "0 1px 4px rgba(0,0,0,0.4)" }}
            >
              {slide.title}
            </h2>
            {slide.body.map((para, j) => (
              <p
                key={j}
                className="leading-relaxed"
                style={{
                  fontSize: "clamp(0.8rem, 1.4vw, 1rem)",
                  marginBottom: j < slide.body.length - 1 ? "0.6rem" : 0,
                  textShadow: "0 1px 3px rgba(0,0,0,0.35)",
                  whiteSpace: "pre-line",
                }}
              >
                {para}
              </p>
            ))}
          </div>
        </div>
      ))}

      {/* Prev arrow */}
      <button
        onClick={prev}
        aria-label="上一張"
        className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors"
        style={{ fontSize: "1.5rem", lineHeight: 1 }}
      >
        &#8249;
      </button>

      {/* Next arrow */}
      <button
        onClick={next}
        aria-label="下一張"
        className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white transition-colors"
        style={{ fontSize: "1.5rem", lineHeight: 1 }}
      >
        &#8250;
      </button>

      {/* Dot indicators */}
      {slides.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`第 ${i + 1} 張`}
              className="w-1.5 h-1.5 rounded-full transition-colors"
              style={{ backgroundColor: i === current ? "white" : "rgba(255,255,255,0.45)" }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
