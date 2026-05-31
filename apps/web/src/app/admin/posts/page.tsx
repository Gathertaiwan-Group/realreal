import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AdminTabs } from "../_components/AdminTabs"

export const metadata = { title: "文章管理 | Admin" }

type Post = {
  id: string
  title: string
  status: "draft" | "published" | "scheduled"
  category?: { name: string; slug?: string } | null
  post_category?: { name: string; slug?: string } | null
  author?: { display_name: string } | null
  published_at: string | null
  created_at: string
}

type PostCategory = {
  id: string
  name: string
  slug: string
}

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "draft", label: "草稿" },
  { key: "published", label: "已發佈" },
  { key: "scheduled", label: "排程" },
] as const

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "草稿", variant: "secondary" },
  published: { label: "已發佈", variant: "default" },
  scheduled: { label: "排程", variant: "outline" },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-"
  return new Date(dateStr).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function buildQuery(status: string, category: string) {
  const parts: string[] = []
  if (status && status !== "all") parts.push(`status=${encodeURIComponent(status)}`)
  if (category && category !== "all") parts.push(`category=${encodeURIComponent(category)}`)
  return parts.length ? `?${parts.join("&")}` : ""
}

export default async function AdminPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; category?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login?redirect=/admin/posts")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (!profile || !["admin", "editor"].includes(profile.role)) redirect("/")

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token

  const params = await searchParams
  const activeTab = params.status ?? "all"
  const activeCategory = params.category ?? "all"

  const url = new URL(`${process.env.NEXT_PUBLIC_API_URL}/admin/posts`)
  if (activeTab !== "all") url.searchParams.set("status", activeTab)

  let posts: Post[] = []
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (res.ok) {
      const json = await res.json()
      posts = json.data ?? json
    }
  } catch {
    // API unavailable — show empty state
  }

  // Fetch post categories for filter chips
  let categories: PostCategory[] = []
  try {
    const catRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/post-categories`, {
      cache: "no-store",
    })
    if (catRes.ok) {
      const json = await catRes.json()
      categories = json.data ?? json
    }
  } catch {
    // API unavailable — no chips
  }

  // Client-side filter posts by selected category slug
  const filteredPosts =
    activeCategory === "all"
      ? posts
      : posts.filter((p) => {
          const slug = p.post_category?.slug ?? p.category?.slug
          return slug === activeCategory
        })

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <AdminTabs tabs={[{ href: "/admin/posts", label: "文章" }, { href: "/admin/posts/categories", label: "分類" }]} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#10305a]">文章管理</h1>
        <Link href="/admin/posts/new">
          <Button className="bg-[#10305a] hover:bg-[#10305a]/90 rounded-[10px]">
            新增文章
          </Button>
        </Link>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/posts${buildQuery(tab.key, activeCategory)}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-[#10305a] text-[#10305a]"
                : "border-transparent text-[#687279] hover:text-[#10305a] hover:border-gray-300"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Category Filter Chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6 overflow-x-auto">
          <Link
            href={`/admin/posts${buildQuery(activeTab, "all")}`}
            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
              activeCategory === "all"
                ? "bg-[#10305a] text-white border-[#10305a]"
                : "bg-white text-[#687279] border-gray-200 hover:border-[#10305a] hover:text-[#10305a]"
            }`}
          >
            全部
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/admin/posts${buildQuery(activeTab, cat.slug)}`}
              className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                activeCategory === cat.slug
                  ? "bg-[#10305a] text-white border-[#10305a]"
                  : "bg-white text-[#687279] border-gray-200 hover:border-[#10305a] hover:text-[#10305a]"
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      )}

      {/* Posts Table */}
      <div className="border rounded-[10px] overflow-hidden">
        {/* Table Header */}
        <div className="hidden md:grid grid-cols-[1fr_100px_120px_120px_160px_100px] gap-4 px-4 py-3 bg-gray-50 text-xs font-medium text-[#687279] uppercase">
          <span>標題</span>
          <span>狀態</span>
          <span>分類</span>
          <span>作者</span>
          <span>日期</span>
          <span className="text-right">操作</span>
        </div>

        <div className="divide-y">
          {filteredPosts.length === 0 && (
            <p className="p-8 text-center text-[#687279]">尚無文章</p>
          )}
          {filteredPosts.map((post) => {
            const cfg = STATUS_CONFIG[post.status] ?? STATUS_CONFIG.draft
            const categoryName =
              post.post_category?.name ?? post.category?.name ?? "—"
            return (
              <div
                key={post.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_100px_120px_120px_160px_100px] gap-2 md:gap-4 items-center px-4 py-3 hover:bg-gray-50/50 transition-colors"
              >
                <div className="min-w-0">
                  <Link
                    href={`/admin/posts/${post.id}`}
                    className="font-medium text-[#10305a] hover:underline truncate block"
                  >
                    {post.title}
                  </Link>
                </div>
                <div>
                  <Badge variant={cfg.variant}>{cfg.label}</Badge>
                </div>
                <span className="text-sm text-[#687279] truncate">
                  {categoryName}
                </span>
                <span className="text-sm text-[#687279] truncate">
                  {post.author?.display_name ?? "-"}
                </span>
                <span className="text-sm text-[#687279]">
                  {formatDate(post.published_at ?? post.created_at)}
                </span>
                <div className="flex items-center justify-end gap-2">
                  <Link href={`/admin/posts/${post.id}`}>
                    <Button variant="outline" size="sm" className="rounded-[10px]">
                      編輯
                    </Button>
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
