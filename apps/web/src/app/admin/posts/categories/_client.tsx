"use client"

import { useCallback, useEffect, useState, useTransition } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Plus, Trash2, X } from "lucide-react"
import { adminFetch } from "@/lib/admin-fetch"

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.RAILWAY_API_URL ??
  "http://localhost:4000"

export interface PostCategoryRow {
  id: string
  name: string
  slug: string
  description?: string | null
  post_count?: number
  created_at?: string
}

interface PostCategoriesClientProps {
  initialData: PostCategoryRow[]
}

/** Slugify a name. ASCII letters/digits/hyphens only; fallback to `cat-xxxx` for pure-CJK. */
function autoSlug(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  if (cleaned.length > 0) return cleaned
  // Pure non-ASCII: random suffix
  const rand = Math.random().toString(36).slice(2, 6)
  return `cat-${rand}`
}

export function PostCategoriesClient({ initialData }: PostCategoriesClientProps) {
  const [rows, setRows] = useState<PostCategoryRow[]>(initialData)
  const [isPending, startTransition] = useTransition()
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState("")

  /* ---- Refresh ---- */

  const refresh = useCallback(async () => {
    try {
      // Prefer admin endpoint (post_count); fall back to public list.
      let res = await adminFetch(`${API_URL}/admin/post-categories`)
      if (!res.ok) {
        res = await adminFetch(`${API_URL}/post-categories`)
      }
      if (!res.ok) throw new Error("讀取分類失敗")
      const json = await res.json()
      const next: PostCategoryRow[] = json.data ?? json.categories ?? []
      setRows(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "讀取分類失敗")
    }
  }, [])

  useEffect(() => {
    // If SSR auth race produced an empty list, retry on the client.
    if (initialData.length === 0) {
      refresh()
    }
  }, [initialData.length, refresh])

  /* ---- Create ---- */

  function createCategory(name: string) {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("請輸入分類名稱")
      return
    }
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/post-categories`, {
          method: "POST",
          body: JSON.stringify({
            name: trimmed,
            slug: autoSlug(trimmed),
          }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error?.formErrors?.[0] ?? errBody.error ?? "建立失敗")
        }
        toast.success("已新增分類")
        setShowCreate(false)
        setCreateName("")
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "建立失敗")
      }
    })
  }

  /* ---- Update (name) ---- */

  function updateName(id: string, original: string, next: string) {
    const trimmed = next.trim()
    if (!trimmed || trimmed === original) return
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/post-categories/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name: trimmed }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error?.formErrors?.[0] ?? errBody.error ?? "更新失敗")
        }
        toast.success("分類名稱已更新")
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新失敗")
      }
    })
  }

  /* ---- Delete ---- */

  function deleteCategory(id: string, name: string, postCount: number) {
    if (postCount > 0) return // guard belt-and-suspenders
    if (!confirm(`確定要刪除分類「${name}」嗎？此操作無法還原。`)) return
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/post-categories/${id}`, {
          method: "DELETE",
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          if (errBody.detail?.posts) {
            throw new Error(`分類使用中，無法刪除（文章 ${errBody.detail.posts} 篇）`)
          }
          throw new Error(errBody.error ?? "刪除失敗")
        }
        toast.success("分類已刪除")
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "刪除失敗")
      }
    })
  }

  /* ---- Render ---- */

  return (
    <div className="space-y-4">
      {/* Create button / inline form */}
      {!showCreate ? (
        <Button size="sm" onClick={() => setShowCreate(true)} disabled={isPending}>
          <Plus className="w-4 h-4 mr-1" />
          新增分類
        </Button>
      ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">新增文章分類</h3>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false)
                setCreateName("")
              }}
              className="text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">分類名稱</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="例：營養知識"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    createCategory(createName)
                  }
                }}
              />
              <p className="text-[10px] text-zinc-400">
                slug 將自動由名稱產生（純漢字會 fallback 為 cat-xxxx）
              </p>
            </div>
            <Button size="sm" onClick={() => createCategory(createName)} disabled={isPending}>
              {isPending ? "建立中..." : "建立"}
            </Button>
          </div>
        </Card>
      )}

      {/* Flat table */}
      <Card className="overflow-hidden">
        <div className="bg-zinc-50 px-4 py-2 text-xs text-zinc-500 grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-center">
          <span>名稱</span>
          <span>slug</span>
          <span>文章數</span>
          <span className="text-right pr-1">操作</span>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-zinc-400 text-sm">
            尚無分類，點擊上方按鈕新增第一個分類
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((row) => (
              <PostCategoryRowItem
                key={row.id}
                row={row}
                isPending={isPending}
                onUpdateName={updateName}
                onDelete={deleteCategory}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Row component                                                      */
/* ------------------------------------------------------------------ */

interface PostCategoryRowItemProps {
  row: PostCategoryRow
  isPending: boolean
  onUpdateName: (id: string, original: string, next: string) => void
  onDelete: (id: string, name: string, postCount: number) => void
}

function PostCategoryRowItem({
  row,
  isPending,
  onUpdateName,
  onDelete,
}: PostCategoryRowItemProps) {
  const postCount = row.post_count ?? 0
  const blockedFromDelete = postCount > 0
  const blockReason = blockedFromDelete ? "尚有文章使用此分類" : "刪除"

  return (
    <div className="px-4 py-3 grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-center hover:bg-zinc-50/60">
      {/* Name (inline edit) */}
      <div className="min-w-0">
        <Input
          defaultValue={row.name}
          className="h-8 text-sm font-medium px-2"
          disabled={isPending}
          onBlur={(e) => onUpdateName(row.id, row.name, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
        />
      </div>

      {/* Slug (gray, read-only) */}
      <code className="text-xs font-mono text-zinc-400 truncate px-2">{row.slug}</code>

      {/* Post count badge */}
      <Badge variant={postCount > 0 ? "default" : "secondary"} className="text-xs">
        {postCount}
      </Badge>

      {/* Delete */}
      <div className="flex items-center gap-1 justify-end">
        <button
          type="button"
          onClick={() => !blockedFromDelete && onDelete(row.id, row.name, postCount)}
          disabled={blockedFromDelete || isPending}
          title={blockReason}
          className="p-1.5 rounded hover:bg-red-50 text-zinc-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-500"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
