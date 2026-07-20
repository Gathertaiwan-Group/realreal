import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { STATIONS, Badge } from "../stations"
import { StationTabs } from "../StationTabs"

export function generateStaticParams() {
  return STATIONS.map((s) => ({ slug: s.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const station = STATIONS.find((s) => s.slug === slug)
  if (!station) return {}
  return {
    title: `${station.tabLabel}｜${station.title} | 誠真生活 RealReal`,
    description: `誠真生活善意行動紀錄 — ${station.tabLabel}：${station.title}。`,
  }
}

export default async function StationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const station = STATIONS.find((s) => s.slug === slug)
  if (!station) notFound()

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8 text-center text-[#10305a]">善意行動紀錄</h1>

      <StationTabs />

      {station.badge && (
        <div className="text-center mb-2">
          <Badge badge={station.badge} />
        </div>
      )}
      <h2 className="text-2xl font-bold text-center text-[#10305a] mt-4 mb-1">
        {station.tabLabel}｜{station.title}
      </h2>
      {station.subtitle && (
        <p className="text-center text-lg text-[#687279] mb-3">{station.subtitle}</p>
      )}
      <p className="text-center text-[#a09080] text-sm mb-1">{station.dateLabel}</p>
      {station.supportUnit && (
        <p className="text-center text-[#a09080] text-sm mb-1">支持單位｜{station.supportUnit}</p>
      )}
      {station.note && (
        <p className="text-center text-[#a09080] text-sm mb-1">{station.note}</p>
      )}
      <div className="mb-8" />

      <article>{station.content}</article>
    </div>
  )
}
