"use client"
import { useEffect, useState } from "react"

export type CategoryHeroProps = {
  bannerUrl?: string | null
  tagline: string
  subtitle?: string | null
}

/**
 * Full-width category banner with centered tagline + subtitle.
 *
 * - If `bannerUrl` is provided, renders it as a background <img> with a
 *   dark overlay for text legibility. Otherwise falls back to a brand-color
 *   gradient background.
 * - Fades in (opacity 0 -> 1, 600ms) on mount via useState + setTimeout.
 *
 * Per spec J Section 5.
 */
export function CategoryHero({ bannerUrl, tagline, subtitle }: CategoryHeroProps) {
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setOpacity(1), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <section className="relative w-full h-[320px] md:h-[480px] overflow-hidden">
      {bannerUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bannerUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black/40" />
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, #10305a 0%, #1e4a82 50%, #2b66ad 100%)",
          }}
        />
      )}

      <div
        className="relative z-10 flex h-full flex-col items-center justify-center px-4 text-center text-white transition-opacity duration-700 ease-out"
        style={{ opacity }}
      >
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight drop-shadow-md">
          {tagline}
        </h1>
        {subtitle && (
          <p className="mt-4 text-lg md:text-xl text-white/90 drop-shadow max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
    </section>
  )
}
