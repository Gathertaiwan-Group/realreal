const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

/* ---------- types ---------- */

export type Post = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content_html: string | null
  cover_image: string | null
  category: string | null
  author: string | null
  published_at: string | null
  seo_title: string | null
  seo_description: string | null
  created_at: string
}

/* ---------- site contents ---------- */

export async function getSiteContent<T = unknown>(key: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}/site-contents/${key}`, {
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = await res.json()
    return (json.data ?? json.value ?? json) as T
  } catch {
    return null
  }
}

/* ---------- posts ---------- */

export async function getPosts(
  params?: { page?: number; limit?: number; category?: string }
): Promise<{ data: Post[]; total: number }> {
  const sp = new URLSearchParams()
  if (params?.page) sp.set("page", String(params.page))
  if (params?.limit) sp.set("limit", String(params.limit))
  if (params?.category) sp.set("category", params.category)
  const res = await fetch(`${API_URL}/posts?${sp}`, {
    next: { revalidate: 60 },
  })
  if (!res.ok) return { data: [], total: 0 }
  return res.json()
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
  try {
    const res = await fetch(`${API_URL}/posts/${slug}`, {
      cache: "no-store",
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? json
  } catch {
    return null
  }
}
