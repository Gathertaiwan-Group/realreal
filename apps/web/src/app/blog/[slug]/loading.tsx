export default function BlogPostLoading() {
  return (
    <article className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
        {/* Breadcrumb skeleton */}
        <div className="mb-8 flex items-center gap-2">
          <div className="h-4 w-8 animate-pulse rounded bg-zinc-100" />
          <div className="h-4 w-2 animate-pulse rounded bg-zinc-100" />
          <div className="h-4 w-16 animate-pulse rounded bg-zinc-100" />
          <div className="h-4 w-2 animate-pulse rounded bg-zinc-100" />
          <div className="h-4 w-40 animate-pulse rounded bg-zinc-100" />
        </div>

        {/* Header skeleton */}
        <header className="mb-10">
          <div className="mb-4 h-6 w-20 animate-pulse rounded-full bg-[#10305a]/10" />
          <div className="space-y-3">
            <div className="h-8 w-full animate-pulse rounded bg-zinc-100" />
            <div className="h-8 w-4/5 animate-pulse rounded bg-zinc-100" />
          </div>
          <div className="mt-4 flex gap-3">
            <div className="h-4 w-24 animate-pulse rounded bg-zinc-100" />
            <div className="h-4 w-28 animate-pulse rounded bg-zinc-100" />
          </div>
        </header>

        {/* Content skeleton */}
        <div className="space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-zinc-100"
              style={{ width: `${75 + (i % 3) * 10}%` }}
            />
          ))}
          <div className="py-2" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i + 10}
              className="h-4 animate-pulse rounded bg-zinc-100"
              style={{ width: `${65 + (i % 4) * 8}%` }}
            />
          ))}
        </div>
      </div>
    </article>
  )
}
