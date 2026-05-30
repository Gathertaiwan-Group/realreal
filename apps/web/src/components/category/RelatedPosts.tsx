import Link from "next/link"

export type RelatedPost = {
  slug: string
  title: string
  excerpt?: string | null
  cover_image?: string | null
}

export type RelatedPostsProps = {
  heading: string
  posts: RelatedPost[]
}

/**
 * 4-up grid of blog cards shown at the bottom of a category landing page.
 *
 * Per spec J Section 4.
 */
export function RelatedPosts({ heading, posts }: RelatedPostsProps) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <h2
        className="text-2xl md:text-3xl font-semibold mb-8 text-center"
        style={{ color: "#10305a" }}
      >
        {heading}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/posts/${post.slug}`}
            className="group flex flex-col bg-white overflow-hidden transition-shadow hover:shadow-lg"
            style={{ boxShadow: "2px 2px 6px 0 rgba(0,0,0,.15)" }}
          >
            <div className="aspect-video relative bg-zinc-100 overflow-hidden">
              {post.cover_image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.cover_image}
                  alt={post.title}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">
                  無封面
                </div>
              )}
            </div>
            <div className="p-4 flex flex-col flex-1">
              <h3
                className="text-base font-semibold line-clamp-2 mb-2"
                style={{ color: "#10305a" }}
              >
                {post.title}
              </h3>
              {post.excerpt && (
                <p
                  className="text-sm line-clamp-3"
                  style={{ color: "#687279" }}
                >
                  {post.excerpt}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
