"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown, X } from "lucide-react"
import { adminFetch } from "@/lib/admin-fetch"

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.RAILWAY_API_URL ??
  "http://localhost:4000"

export interface FeatureBlock {
  heading: string
  body: string
}

export interface CategoryRow {
  id: string
  name: string
  slug: string
  parent_id: string | null
  sort_order: number
  product_count?: number
  campaign_count?: number
  created_at?: string
  banner_url?: string | null
  tagline?: string | null
  subtitle?: string | null
  feature_blocks?: FeatureBlock[] | null
  related_post_slugs?: string[] | null
}

const MAX_FEATURE_BLOCKS = 3
const MAX_RELATED_POSTS = 4

interface CategoriesClientProps {
  initialData: CategoryRow[]
}

interface CategoryNode extends CategoryRow {
  children: CategoryRow[]
}

function buildTree(rows: CategoryRow[]): CategoryNode[] {
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order)
  const roots: CategoryNode[] = sorted
    .filter((r) => r.parent_id === null)
    .map((r) => ({ ...r, children: [] }))

  const rootMap = new Map(roots.map((r) => [r.id, r]))
  for (const r of sorted) {
    if (r.parent_id && rootMap.has(r.parent_id)) {
      rootMap.get(r.parent_id)!.children.push(r)
    }
  }
  return roots
}

export function CategoriesClient({ initialData }: CategoriesClientProps) {
  const [rows, setRows] = useState<CategoryRow[]>(initialData)
  const [isPending, startTransition] = useTransition()
  const [showCreateRoot, setShowCreateRoot] = useState(false)
  const [createRootName, setCreateRootName] = useState("")
  const [createChildFor, setCreateChildFor] = useState<string | null>(null)
  const [createChildName, setCreateChildName] = useState("")

  const tree = useMemo(() => buildTree(rows), [rows])

  /* ---- Refresh ---- */

  const refresh = useCallback(async () => {
    try {
      const res = await adminFetch(`${API_URL}/admin/categories`)
      if (!res.ok) throw new Error("讀取分類失敗")
      const json = await res.json()
      const next: CategoryRow[] = json.data ?? json.categories ?? []
      setRows(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "讀取分類失敗")
    }
  }, [])

  useEffect(() => {
    // If server hydration came back empty (e.g. SSR auth race), try again client-side
    if (initialData.length === 0) {
      refresh()
    }
  }, [initialData.length, refresh])

  /* ---- Create ---- */

  function createCategory(name: string, parentId: string | null, sortOrder: number) {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("請輸入分類名稱")
      return
    }
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/categories`, {
          method: "POST",
          body: JSON.stringify({
            name: trimmed,
            parent_id: parentId,
            sort_order: sortOrder,
          }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error?.formErrors?.[0] ?? errBody.error ?? "建立失敗")
        }
        toast.success(parentId ? "已新增子分類" : "已新增頂層分類")
        if (parentId) {
          setCreateChildFor(null)
          setCreateChildName("")
        } else {
          setShowCreateRoot(false)
          setCreateRootName("")
        }
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
        const res = await adminFetch(`${API_URL}/admin/categories/${id}`, {
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

  /* ---- Update (sort_order direct input) ---- */

  function updateSortOrder(id: string, original: number, next: number) {
    if (!Number.isFinite(next) || next < 0 || next === original) return
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/categories/${id}`, {
          method: "PUT",
          body: JSON.stringify({ sort_order: Math.floor(next) }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error?.formErrors?.[0] ?? errBody.error ?? "更新失敗")
        }
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新排序失敗")
      }
    })
  }

  /* ---- Swap sort_order with neighbor (↑ / ↓) ---- */

  function swapWithNeighbor(id: string, direction: "up" | "down") {
    // Group siblings by parent_id, sorted by sort_order
    const target = rows.find((r) => r.id === id)
    if (!target) return
    const siblings = rows
      .filter((r) => r.parent_id === target.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order)
    const idx = siblings.findIndex((r) => r.id === id)
    if (idx === -1) return
    const neighborIdx = direction === "up" ? idx - 1 : idx + 1
    if (neighborIdx < 0 || neighborIdx >= siblings.length) return
    const neighbor = siblings[neighborIdx]
    const a = target.sort_order
    const b = neighbor.sort_order

    startTransition(async () => {
      try {
        // If equal sort_order, bump one so the swap is meaningful
        const aNext = a === b ? b - 1 : b
        const bNext = a === b ? a : a
        const r1 = await adminFetch(`${API_URL}/admin/categories/${target.id}`, {
          method: "PUT",
          body: JSON.stringify({ sort_order: aNext }),
        })
        if (!r1.ok) throw new Error("排序更新失敗")
        const r2 = await adminFetch(`${API_URL}/admin/categories/${neighbor.id}`, {
          method: "PUT",
          body: JSON.stringify({ sort_order: bNext }),
        })
        if (!r2.ok) throw new Error("排序更新失敗")
        await refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "排序更新失敗")
      }
    })
  }

  /* ---- Delete ---- */

  function deleteCategory(id: string, name: string) {
    if (!confirm(`確定要刪除分類「${name}」嗎？此操作無法還原。`)) return
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/categories/${id}`, { method: "DELETE" })
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}))
          if (errBody.detail) {
            const { children = 0, products = 0, campaigns = 0 } = errBody.detail
            throw new Error(
              `分類使用中，無法刪除（子分類 ${children} / 商品 ${products} / 行銷活動 ${campaigns}）`,
            )
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

  /* ---- Update (landing fields: banner / tagline / subtitle / features / related posts) ---- */

  const saveLanding = useCallback(
    (
      id: string,
      payload: {
        banner_url: string | null
        tagline: string | null
        subtitle: string | null
        feature_blocks: FeatureBlock[]
        related_post_slugs: string[]
      },
    ) => {
      return new Promise<boolean>((resolve) => {
        startTransition(async () => {
          try {
            const res = await adminFetch(`${API_URL}/admin/categories/${id}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            })
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}))
              throw new Error(
                errBody.error?.formErrors?.[0] ??
                  (typeof errBody.error === "string" ? errBody.error : null) ??
                  "Landing 設定儲存失敗",
              )
            }
            toast.success("Landing 設定已儲存")
            await refresh()
            resolve(true)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Landing 設定儲存失敗")
            resolve(false)
          }
        })
      })
    },
    [refresh],
  )

  /* ---- Render ---- */

  return (
    <div className="space-y-4">
      {/* Top-level create */}
      {!showCreateRoot ? (
        <Button size="sm" onClick={() => setShowCreateRoot(true)} disabled={isPending}>
          <Plus className="w-4 h-4 mr-1" />
          新增頂層分類
        </Button>
      ) : (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">新增頂層分類</h3>
            <button
              type="button"
              onClick={() => {
                setShowCreateRoot(false)
                setCreateRootName("")
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
                value={createRootName}
                onChange={(e) => setCreateRootName(e.target.value)}
                placeholder="例：凍乾水果"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    const maxOrder = Math.max(
                      0,
                      ...tree.map((t) => t.sort_order),
                    )
                    createCategory(createRootName, null, maxOrder + 1)
                  }
                }}
              />
              <p className="text-[10px] text-zinc-400">slug 將自動由名稱產生（純漢字會 fallback 為 cat-xxxx）</p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                const maxOrder = Math.max(0, ...tree.map((t) => t.sort_order))
                createCategory(createRootName, null, maxOrder + 1)
              }}
              disabled={isPending}
            >
              {isPending ? "建立中..." : "建立"}
            </Button>
          </div>
        </Card>
      )}

      {/* Tree */}
      <Card className="overflow-hidden">
        <div className="bg-zinc-50 px-4 py-2 text-xs text-zinc-500 grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center">
          <span className="w-4" />
          <span>名稱 / slug</span>
          <span>排序</span>
          <span>商品</span>
          <span>活動</span>
          <span className="text-right pr-1">操作</span>
        </div>

        {tree.length === 0 ? (
          <div className="px-4 py-12 text-center text-zinc-400 text-sm">
            尚無分類，點擊上方按鈕新增頂層分類
          </div>
        ) : (
          <div className="divide-y">
            {tree.map((node, rootIdx) => (
              <div key={node.id}>
                <CategoryRowItem
                  node={node}
                  indent={0}
                  isFirst={rootIdx === 0}
                  isLast={rootIdx === tree.length - 1}
                  isPending={isPending}
                  onUpdateName={updateName}
                  onUpdateSortOrder={updateSortOrder}
                  onSwap={swapWithNeighbor}
                  onDelete={deleteCategory}
                  onSaveLanding={saveLanding}
                  onAddChild={() => setCreateChildFor(node.id)}
                  canAddChild
                />

                {/* Children */}
                {node.children.map((child, childIdx) => (
                  <CategoryRowItem
                    key={child.id}
                    node={{ ...child, children: [] }}
                    indent={1}
                    isFirst={childIdx === 0}
                    isLast={childIdx === node.children.length - 1}
                    isPending={isPending}
                    onUpdateName={updateName}
                    onUpdateSortOrder={updateSortOrder}
                    onSwap={swapWithNeighbor}
                    onDelete={deleteCategory}
                    onSaveLanding={saveLanding}
                    onAddChild={() => {
                      /* no-op: children can't have grandchildren */
                    }}
                    canAddChild={false}
                  />
                ))}

                {/* Inline add-child form */}
                {createChildFor === node.id && (
                  <div className="pl-12 pr-4 py-3 bg-blue-50/40 border-t">
                    <div className="flex items-end gap-3">
                      <div className="flex-1 space-y-1.5">
                        <Label className="text-xs">子分類名稱（隸屬於「{node.name}」）</Label>
                        <Input
                          value={createChildName}
                          onChange={(e) => setCreateChildName(e.target.value)}
                          placeholder="例：芒果乾"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              const maxOrder = Math.max(
                                0,
                                ...node.children.map((c) => c.sort_order),
                              )
                              createCategory(createChildName, node.id, maxOrder + 1)
                            }
                          }}
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          const maxOrder = Math.max(
                            0,
                            ...node.children.map((c) => c.sort_order),
                          )
                          createCategory(createChildName, node.id, maxOrder + 1)
                        }}
                        disabled={isPending}
                      >
                        {isPending ? "建立中..." : "建立"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCreateChildFor(null)
                          setCreateChildName("")
                        }}
                        disabled={isPending}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
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

interface CategoryRowItemProps {
  node: CategoryNode
  indent: 0 | 1
  isFirst: boolean
  isLast: boolean
  isPending: boolean
  onUpdateName: (id: string, original: string, next: string) => void
  onUpdateSortOrder: (id: string, original: number, next: number) => void
  onSwap: (id: string, direction: "up" | "down") => void
  onDelete: (id: string, name: string) => void
  onSaveLanding: (
    id: string,
    payload: {
      banner_url: string | null
      tagline: string | null
      subtitle: string | null
      feature_blocks: FeatureBlock[]
      related_post_slugs: string[]
    },
  ) => Promise<boolean>
  onAddChild: () => void
  canAddChild: boolean
}

function CategoryRowItem({
  node,
  indent,
  isFirst,
  isLast,
  isPending,
  onUpdateName,
  onUpdateSortOrder,
  onSwap,
  onDelete,
  onSaveLanding,
  onAddChild,
  canAddChild,
}: CategoryRowItemProps) {
  const productCount = node.product_count ?? 0
  const campaignCount = node.campaign_count ?? 0
  const blockedFromDelete = productCount > 0 || campaignCount > 0 || node.children.length > 0
  const blockReason =
    node.children.length > 0
      ? "請先刪除子分類"
      : productCount > 0
        ? "尚有商品使用此分類"
        : campaignCount > 0
          ? "尚有行銷活動引用此分類"
          : ""

  const indentPx = indent === 1 ? 32 : 0

  return (
    <>
    <div
      className={`px-4 py-3 grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3 items-center hover:bg-zinc-50/60 ${
        indent === 1 ? "bg-zinc-50/30" : ""
      }`}
      style={{ paddingLeft: 16 + indentPx }}
    >
      {/* Drag handle (visual only in v1) */}
      <span
        className="text-zinc-300 cursor-grab"
        title="拖曳排序（v1 未啟用；請用 ↑↓ 或排序欄位）"
      >
        <GripVertical className="w-4 h-4" />
      </span>

      {/* Name (inline edit) + slug */}
      <div className="min-w-0">
        <Input
          defaultValue={node.name}
          className="h-8 text-sm font-medium px-2"
          disabled={isPending}
          onBlur={(e) => onUpdateName(node.id, node.name, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
        />
        <p className="text-[11px] text-zinc-400 mt-1 px-2 truncate">
          slug: <code className="font-mono">{node.slug}</code>
        </p>
      </div>

      {/* Sort order: input + ↑↓ */}
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          defaultValue={node.sort_order}
          key={`${node.id}-${node.sort_order}`}
          className="h-8 w-16 text-sm text-center px-1"
          disabled={isPending}
          onBlur={(e) => {
            const next = Number(e.currentTarget.value)
            onUpdateSortOrder(node.id, node.sort_order, next)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
        />
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => onSwap(node.id, "up")}
            disabled={isFirst || isPending}
            className="p-0.5 rounded hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
            title="上移"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => onSwap(node.id, "down")}
            disabled={isLast || isPending}
            className="p-0.5 rounded hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
            title="下移"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Product count */}
      <Badge variant={productCount > 0 ? "default" : "secondary"} className="text-xs">
        {productCount}
      </Badge>

      {/* Campaign count */}
      <Badge variant={campaignCount > 0 ? "outline" : "secondary"} className="text-xs">
        {campaignCount}
      </Badge>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        {canAddChild ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onAddChild}
            disabled={isPending}
            className="h-7 text-xs"
          >
            <Plus className="w-3 h-3 mr-0.5" />
            子分類
          </Button>
        ) : (
          <span className="w-[68px]" />
        )}
        <button
          type="button"
          onClick={() => !blockedFromDelete && onDelete(node.id, node.name)}
          disabled={blockedFromDelete || isPending}
          title={blockedFromDelete ? blockReason : "刪除"}
          className="p-1.5 rounded hover:bg-red-50 text-zinc-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-500"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <LandingSettings
      categoryId={node.id}
      categorySlug={node.slug}
      indentPx={indentPx}
      isPending={isPending}
      onSave={onSaveLanding}
    />
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  LandingSettings — collapsible per-row editor for Landing 頁設定    */
/* ------------------------------------------------------------------ */

interface LandingSettingsProps {
  categoryId: string
  categorySlug: string
  indentPx: number
  isPending: boolean
  onSave: (
    id: string,
    payload: {
      banner_url: string | null
      tagline: string | null
      subtitle: string | null
      feature_blocks: FeatureBlock[]
      related_post_slugs: string[]
    },
  ) => Promise<boolean>
}

function LandingSettings({
  categoryId,
  categorySlug,
  indentPx,
  isPending,
  onSave,
}: LandingSettingsProps) {
  const [opened, setOpened] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [bannerUrl, setBannerUrl] = useState("")
  const [tagline, setTagline] = useState("")
  const [subtitle, setSubtitle] = useState("")
  const [featureBlocks, setFeatureBlocks] = useState<FeatureBlock[]>([])
  const [relatedSlugsText, setRelatedSlugsText] = useState("")

  // Lazy-load landing fields from public GET /categories/:slug the first time the section is opened
  useEffect(() => {
    if (!opened || loaded || loading) return
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/categories/${categorySlug}`)
        if (!res.ok) throw new Error("讀取 Landing 資料失敗")
        const json = await res.json()
        const cat = json.category ?? json.data ?? json
        setBannerUrl(typeof cat.banner_url === "string" ? cat.banner_url : "")
        setTagline(typeof cat.tagline === "string" ? cat.tagline : "")
        setSubtitle(typeof cat.subtitle === "string" ? cat.subtitle : "")
        const blocks: FeatureBlock[] = Array.isArray(cat.feature_blocks)
          ? cat.feature_blocks
              .slice(0, MAX_FEATURE_BLOCKS)
              .map((b: any) => ({
                heading: typeof b?.heading === "string" ? b.heading : "",
                body: typeof b?.body === "string" ? b.body : "",
              }))
          : []
        setFeatureBlocks(blocks)
        const slugs: string[] = Array.isArray(cat.related_post_slugs)
          ? cat.related_post_slugs.filter((s: any) => typeof s === "string")
          : []
        setRelatedSlugsText(slugs.join("\n"))
        setLoaded(true)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "讀取 Landing 資料失敗")
      } finally {
        setLoading(false)
      }
    })()
  }, [opened, loaded, loading, categorySlug])

  function updateBlock(idx: number, patch: Partial<FeatureBlock>) {
    setFeatureBlocks((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    )
  }

  function addBlock() {
    setFeatureBlocks((prev) =>
      prev.length >= MAX_FEATURE_BLOCKS ? prev : [...prev, { heading: "", body: "" }],
    )
  }

  function removeBlock(idx: number) {
    setFeatureBlocks((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    // Normalize related slugs: split on newline OR comma, trim, drop empties, cap at MAX_RELATED_POSTS
    const slugs = relatedSlugsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, MAX_RELATED_POSTS)

    // Drop fully-empty feature blocks; cap at MAX_FEATURE_BLOCKS
    const blocks = featureBlocks
      .map((b) => ({ heading: b.heading.trim(), body: b.body.trim() }))
      .filter((b) => b.heading.length > 0 || b.body.length > 0)
      .slice(0, MAX_FEATURE_BLOCKS)

    await onSave(categoryId, {
      banner_url: bannerUrl.trim() ? bannerUrl.trim() : null,
      tagline: tagline.trim() ? tagline.trim() : null,
      subtitle: subtitle.trim() ? subtitle.trim() : null,
      feature_blocks: blocks,
      related_post_slugs: slugs,
    })
  }

  return (
    <details
      className="border-t bg-zinc-50/40"
      onToggle={(e) => setOpened((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        className="cursor-pointer select-none px-4 py-2 text-xs text-zinc-600 hover:text-zinc-900"
        style={{ paddingLeft: 16 + indentPx + 20 }}
      >
        Landing 頁設定
      </summary>

      <div
        className="pr-4 pb-4 pt-2 space-y-4"
        style={{ paddingLeft: 16 + indentPx + 20 }}
      >
        {loading && !loaded ? (
          <p className="text-xs text-zinc-400">載入中…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Banner URL</Label>
                <Input
                  value={bannerUrl}
                  onChange={(e) => setBannerUrl(e.target.value)}
                  placeholder="https://...  (建議寬度 1600px 以上)"
                  className="h-8 text-sm"
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Tagline（大字標語，一行）</Label>
                <Input
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="例：為你的笑容，鎖住每一口純粹"
                  className="h-8 text-sm"
                  disabled={isPending}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label className="text-xs">Subtitle（副標，一行）</Label>
                <Input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="例：孩子的笑容，是世界上最純粹的能量。"
                  className="h-8 text-sm"
                  disabled={isPending}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Feature Blocks（賣點區塊，最多 {MAX_FEATURE_BLOCKS} 個）</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={addBlock}
                  disabled={isPending || featureBlocks.length >= MAX_FEATURE_BLOCKS}
                  className="h-7 text-xs"
                >
                  <Plus className="w-3 h-3 mr-0.5" />
                  新增
                </Button>
              </div>
              {featureBlocks.length === 0 ? (
                <p className="text-[11px] text-zinc-400">尚無 Feature Block。點上方「新增」加入第一個。</p>
              ) : (
                <div className="space-y-2">
                  {featureBlocks.map((block, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-zinc-200 bg-white p-3 space-y-2"
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          <Input
                            value={block.heading}
                            onChange={(e) => updateBlock(idx, { heading: e.target.value })}
                            placeholder={`區塊 ${idx + 1} 標題`}
                            className="h-8 text-sm"
                            disabled={isPending}
                          />
                          <Textarea
                            value={block.body}
                            onChange={(e) => updateBlock(idx, { body: e.target.value })}
                            placeholder={`區塊 ${idx + 1} 內文`}
                            className="text-sm min-h-[64px]"
                            disabled={isPending}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeBlock(idx)}
                          disabled={isPending}
                          title="移除此區塊"
                          className="p-1.5 rounded hover:bg-red-50 text-zinc-400 hover:text-red-600 disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                相關文章 slug（每行一個，或以逗號分隔；最多 {MAX_RELATED_POSTS} 筆）
              </Label>
              <Textarea
                value={relatedSlugsText}
                onChange={(e) => setRelatedSlugsText(e.target.value)}
                placeholder={"freeze-dried-mango\nfruit-snack-tips"}
                className="text-sm min-h-[72px] font-mono"
                disabled={isPending}
              />
              <p className="text-[10px] text-zinc-400">
                若留空，前台會 fallback 顯示最近的 4 篇文章。
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={isPending || loading}
              >
                {isPending ? "儲存中..." : "儲存 Landing 設定"}
              </Button>
            </div>
          </>
        )}
      </div>
    </details>
  )
}
