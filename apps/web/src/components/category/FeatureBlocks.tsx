"use client"
import { useInView } from "@/lib/use-in-view"

export type FeatureBlock = {
  heading: string
  body: string
}

export type FeatureBlocksProps = {
  blocks: FeatureBlock[]
}

/**
 * 3-up grid of benefit blocks (1 col mobile / 3 col desktop) with
 * scroll-triggered fade-in + slide-up via IntersectionObserver.
 *
 * Per spec J Section 5.
 */
export function FeatureBlocks({ blocks }: FeatureBlocksProps) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 md:py-20">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10">
        {blocks.map((block, i) => (
          <FeatureBlockItem key={i} block={block} />
        ))}
      </div>
    </section>
  )
}

function FeatureBlockItem({ block }: { block: FeatureBlock }) {
  const { ref, inView } = useInView<HTMLDivElement>(0.1)

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
    >
      <h2
        className="text-xl md:text-2xl font-semibold mb-3"
        style={{ color: "#10305a" }}
      >
        {block.heading}
      </h2>
      <p className="text-base leading-relaxed" style={{ color: "#687279" }}>
        {block.body}
      </p>
    </div>
  )
}
