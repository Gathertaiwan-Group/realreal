"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { TiptapEditor } from "@/components/editor"

export type Post = {
  id?: string
  title: string
  slug: string
  excerpt: string
  content: string
  cover_image_url: string
  category_id: string
  tags: string
  seo_title: string
  seo_description: string
  status: "draft" | "published" | "scheduled"
  scheduled_at: string
}

type Category = {
  id: string
  name: string
}

interface PostFormProps {
  initialData?: Post
  mode: "create" | "edit"
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function PostForm({ initialData, mode }: PostFormProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])

  const [title, setTitle] = useState(initialData?.title ?? "")
  const [slug, setSlug] = useState(initialData?.slug ?? "")
  const [excerpt, setExcerpt] = useState(initialData?.excerpt ?? "")
  const [content, setContent] = useState(initialData?.content ?? "")
  const [coverImageUrl, setCoverImageUrl] = useState(initialData?.cover_image_url ?? "")
  const [categoryId, setCategoryId] = useState(initialData?.category_id ?? "")
  const [tags, setTags] = useState(initialData?.tags ?? "")
  const [seoTitle, setSeoTitle] = useState(initialData?.seo_title ?? "")
  const [seoDescription, setSeoDescription] = useState(initialData?.seo_description ?? "")
  const [status, setStatus] = useState<Post["status"]>(initialData?.status ?? "draft")
  const [scheduledAt, setScheduledAt] = useState(initialData?.scheduled_at ?? "")
  const [slugTouched, setSlugTouched] = useState(!!initialData?.slug)

  useEffect(() => {
    async function fetchCategories() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/post-categories`)
        if (res.ok) {
          const json = await res.json()
          setCategories(json.data ?? json)
        }
      } catch {
        // categories unavailable
      }
    }
    fetchCategories()
  }, [])

  function handleTitleBlur() {
    if (!slugTouched && !slug) {
      setSlug(slugify(title))
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)

    const body = {
      title,
      slug,
      excerpt,
      content,
      cover_image_url: coverImageUrl,
      category_id: categoryId || null,
      tags,
      seo_title: seoTitle,
      seo_description: seoDescription,
      status,
      scheduled_at: status === "scheduled" ? scheduledAt : null,
    }

    const url =
      mode === "edit"
        ? `${process.env.NEXT_PUBLIC_API_URL}/admin/posts/${initialData?.id}`
        : `${process.env.NEXT_PUBLIC_API_URL}/admin/posts`

    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(url, {
        method: mode === "edit" ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        toast.success(mode === "edit" ? "文章已更新" : "文章已建立")
        router.push("/admin/posts")
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err.message ?? "儲存失敗，請稍後再試")
        setSaving(false)
      }
    } catch {
      toast.error("網路錯誤，請稍後再試")
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Main Content */}
      <Card className="rounded-[10px] p-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="title">標題</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            placeholder="文章標題"
            required
            className="rounded-[10px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="slug">網址代碼 (Slug)</Label>
          <Input
            id="slug"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              setSlugTouched(true)
            }}
            placeholder="auto-generated-from-title"
            pattern="[a-z0-9\u4e00-\u9fff-]+"
            className="rounded-[10px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="excerpt">摘要</Label>
          <Textarea
            id="excerpt"
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="文章摘要（顯示在列表頁）"
            rows={3}
            className="rounded-[10px]"
          />
        </div>

        <div className="space-y-2">
          <Label>內容</Label>
          <TiptapEditor
            content={content}
            onChange={setContent}
            placeholder="開始撰寫文章內容..."
          />
        </div>
      </Card>

      {/* Media & Categorization */}
      <Card className="rounded-[10px] p-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="cover_image_url">封面圖片網址</Label>
          <Input
            id="cover_image_url"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            placeholder="https://..."
            type="url"
            className="rounded-[10px]"
          />
          {coverImageUrl && (
            <div className="mt-2 rounded-[10px] overflow-hidden border max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverImageUrl}
                alt="封面預覽"
                className="w-full h-auto object-cover"
                onError={(e) => {
                  ;(e.target as HTMLImageElement).style.display = "none"
                }}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="category_id">分類</Label>
            <select
              id="category_id"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="flex h-9 w-full rounded-[10px] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">選擇分類</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">標籤</Label>
            <Input
              id="tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="以逗號分隔，例如：生活,旅遊"
              className="rounded-[10px]"
            />
          </div>
        </div>
      </Card>

      {/* SEO */}
      <Card className="rounded-[10px] p-6 space-y-5">
        <h2 className="text-lg font-semibold text-[#10305a]">SEO 設定</h2>
        <div className="space-y-2">
          <Label htmlFor="seo_title">SEO 標題</Label>
          <Input
            id="seo_title"
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
            placeholder="搜尋引擎顯示的標題"
            className="rounded-[10px]"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="seo_description">SEO 描述</Label>
          <Textarea
            id="seo_description"
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            placeholder="搜尋引擎顯示的描述"
            rows={3}
            className="rounded-[10px]"
          />
        </div>
      </Card>

      {/* Publishing */}
      <Card className="rounded-[10px] p-6 space-y-5">
        <h2 className="text-lg font-semibold text-[#10305a]">發佈設定</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-2">
            <Label htmlFor="status">狀態</Label>
            <select
              id="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Post["status"])}
              className="flex h-9 w-full rounded-[10px] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="draft">草稿</option>
              <option value="published">已發佈</option>
              <option value="scheduled">排程</option>
            </select>
          </div>

          {status === "scheduled" && (
            <div className="space-y-2">
              <Label htmlFor="scheduled_at">排程時間</Label>
              <Input
                id="scheduled_at"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
                className="rounded-[10px]"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          className="rounded-[10px]"
          onClick={() => router.push("/admin/posts")}
        >
          取消
        </Button>
        <Button
          type="submit"
          disabled={saving}
          className="bg-[#10305a] hover:bg-[#10305a]/90 rounded-[10px]"
        >
          {saving ? "儲存中..." : mode === "edit" ? "更新文章" : "建立文章"}
        </Button>
      </div>
    </form>
  )
}
