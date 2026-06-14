// Content-area loading skeletons for admin routes. Each segment's loading.tsx
// renders one of these so a navigation shows instant structure (the persistent
// sidebar layout stays put) while the server renders the real page. Shapes only
// need to roughly match a list (table) or a detail/edit (cards) page — the point
// is immediate feedback, not a pixel-perfect match.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-zinc-200/80 ${className}`} />
}

/** Skeleton for list/table pages (訂單 / 商品 / 客戶 / 行銷 … lists). */
export function ListSkeleton() {
  return (
    <div>
      <Bar className="h-6 w-32 mb-6" />
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-8 w-16" />
        ))}
      </div>
      <div className="border rounded-lg overflow-hidden bg-white">
        <div className="bg-zinc-50 px-4 py-3 flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} className="h-3 flex-1" />
          ))}
        </div>
        <div className="divide-y divide-zinc-100">
          {Array.from({ length: 8 }).map((_, r) => (
            <div key={r} className="px-4 py-4 flex gap-4 items-center">
              {Array.from({ length: 6 }).map((_, c) => (
                <Bar key={c} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Skeleton for detail / edit pages (訂單明細 / 商品編輯 / 客戶詳情 …). */
export function DetailSkeleton() {
  return (
    <div className="max-w-4xl">
      <Bar className="h-4 w-24 mb-4" />
      <Bar className="h-7 w-72 mb-2" />
      <Bar className="h-4 w-48 mb-6" />
      <div className="flex gap-3 mb-6">
        <Bar className="h-9 w-24" />
        <Bar className="h-9 w-24" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="border rounded-lg bg-white p-6 mb-4 space-y-3">
          <Bar className="h-4 w-28" />
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-5/6" />
          <Bar className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}
