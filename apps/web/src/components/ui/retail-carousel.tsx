"use client"

import { useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type RetailEntry = {
  name: string
  type: string
  address?: string | null
  phone?: string | null
  mapUrl?: string | null
  fbUrl?: string | null
  dates?: string | null
  hours?: string | null
  icon: string
}

export function RetailCarousel({ entries }: { entries: RetailEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current
    if (!el) return
    const card = el.querySelector("[data-card]") as HTMLElement | null
    const cardW = card ? card.offsetWidth + 16 : 300
    el.scrollBy({ left: dir === "left" ? -cardW : cardW, behavior: "smooth" })
  }

  return (
    <div className="relative">
      <button
        onClick={() => scroll("left")}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 hidden sm:flex w-9 h-9 items-center justify-center rounded-full bg-white shadow-md border border-gray-100 text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
        aria-label="上一個"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {entries.map(entry => {
          const isEvent = !!entry.dates
          return (
            <div
              key={entry.name}
              data-card=""
              className="snap-start shrink-0 w-[calc(100vw-5rem)] sm:w-72 rounded-2xl border bg-[#f9fafb] p-6 flex flex-col gap-4"
              style={{
                borderColor: isEvent ? "#fde68a" : "#f3f4f6",
                boxShadow: "2px 2px 12px 0 rgba(16,48,90,.06)",
              }}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{entry.icon}</span>
                <div>
                  <span
                    className="inline-block text-xs font-semibold rounded-full px-2.5 py-0.5 mb-1.5"
                    style={
                      isEvent
                        ? { background: "#fef3c7", color: "#92400e" }
                        : { background: "#e8f0f7", color: "#10305a" }
                    }
                  >
                    {entry.type}
                  </span>
                  <h3 className="text-base font-bold" style={{ color: "#10305a" }}>{entry.name}</h3>
                </div>
              </div>

              <div className="space-y-1.5 text-sm flex-1" style={{ color: "#687279" }}>
                {entry.address && (
                  <p className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">📍</span>
                    {entry.address}
                  </p>
                )}
                {entry.dates && (
                  <p className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0">📅</span>
                    {entry.dates}
                  </p>
                )}
                {entry.hours && (
                  <p className="flex items-center gap-2">
                    <span className="shrink-0">🕐</span>
                    {entry.hours}
                  </p>
                )}
                {entry.phone && (
                  <p className="flex items-center gap-2">
                    <span className="shrink-0">📞</span>
                    <a href={`tel:${entry.phone.replace(/[^0-9]/g, "")}`} className="hover:underline">
                      {entry.phone}
                    </a>
                  </p>
                )}
              </div>

              {(entry.mapUrl || entry.fbUrl) && (
                <div className="flex gap-2 mt-auto">
                  {entry.mapUrl && (
                    <a
                      href={entry.mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors"
                      style={{ background: "#10305a", color: "#fff" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      Google Maps
                    </a>
                  )}
                  {entry.fbUrl && (
                    <a
                      href={entry.fbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors"
                      style={{ background: "#10305a", color: "#fff" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                      Facebook
                    </a>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={() => scroll("right")}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 hidden sm:flex w-9 h-9 items-center justify-center rounded-full bg-white shadow-md border border-gray-100 text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
        aria-label="下一個"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  )
}
