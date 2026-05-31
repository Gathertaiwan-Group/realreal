"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2, GripVertical, Image as ImageIcon, Video } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdminTabs } from "../../_components/AdminTabs"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const SETTINGS_TABS = [
  { href: "/admin/settings", label: "系統參數" },
  { href: "/admin/settings/team", label: "團隊成員" },
  { href: "/admin/settings/email-templates", label: "Email 模板" },
  { href: "/admin/settings/carousel", label: "顧客回饋輪播" },
]

type CarouselItem = {
  type: "image" | "video"
  src: string
  alt: string
}

async function getToken(): Promise<string> {
  const supabase = createClient()
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ""
}

export default function AdminCarouselPage() {
  const [items, setItems] = useState<CarouselItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newSrc, setNewSrc] = useState("")
  const [newAlt, setNewAlt] = useState("")
  const [newType, setNewType] = useState<"image" | "video">("image")

  useEffect(() => {
    async function fetchItems() {
      try {
        const token = await getToken()
        const res = await fetch(`${API_URL}/site-contents/review_carousel`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        })
        if (!res.ok) { setItems([]); return }
        const json = await res.json()
        const arr = json?.data ?? json?.value ?? json
        if (Array.isArray(arr)) setItems(arr)
      } catch {
        toast.error("載入失敗")
      } finally {
        setLoading(false)
      }
    }
    void fetchItems()
  }, [])

  async function handleSave(nextItems: CarouselItem[]) {
    setSaving(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/site-contents/review_carousel`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ value: nextItems }),
      })
      if (!res.ok) throw new Error("save failed")
      setItems(nextItems)
      toast.success("已儲存")
    } catch {
      toast.error("儲存失敗")
    } finally {
      setSaving(false)
    }
  }

  function handleAdd() {
    if (!newSrc.trim()) { toast.error("請輸入圖片/影片網址"); return }
    const item: CarouselItem = {
      type: newType,
      src: newSrc.trim(),
      alt: newAlt.trim() || `顧客回饋 ${items.length + 1}`,
    }
    const next = [...items, item]
    setNewSrc("")
    setNewAlt("")
    setNewType("image")
    void handleSave(next)
  }

  function handleRemove(index: number) {
    const next = items.filter((_, i) => i !== index)
    void handleSave(next)
  }

  function handleMoveUp(index: number) {
    if (index === 0) return
    const next = [...items]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    void handleSave(next)
  }

  function handleMoveDown(index: number) {
    if (index === items.length - 1) return
    const next = [...items]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    void handleSave(next)
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <AdminTabs tabs={SETTINGS_TABS} />
      <div className="mt-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#10305a]">顧客回饋輪播管理</h1>
          <p className="mt-1 text-sm text-zinc-500">
            管理首頁「顧客真實回饋」輪播的圖片與影片。每頁顯示 4 張，支援左右翻頁。
          </p>
        </div>

        {/* Add new item */}
        <div className="rounded-xl border bg-zinc-50/50 p-5 space-y-4">
          <h2 className="font-semibold text-[#10305a]">新增圖片／影片</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>類型</Label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setNewType("image")}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    newType === "image"
                      ? "border-[#10305a] bg-[#10305a]/5 text-[#10305a] font-medium"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  <ImageIcon className="h-4 w-4" /> 圖片
                </button>
                <button
                  type="button"
                  onClick={() => setNewType("video")}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    newType === "video"
                      ? "border-[#10305a] bg-[#10305a]/5 text-[#10305a] font-medium"
                      : "border-zinc-200 text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  <Video className="h-4 w-4" /> 影片
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-alt">說明文字（alt）</Label>
              <Input
                id="new-alt"
                placeholder="例：顧客回饋 1"
                value={newAlt}
                onChange={e => setNewAlt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-src">
              {newType === "image" ? "圖片網址" : "影片網址"}
              <span className="ml-2 text-xs text-zinc-400">
                {newType === "image"
                  ? "（建議：直向比例 9:16，解析度 576×1024 以上）"
                  : "（支援 .mov / .mp4 格式）"}
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="new-src"
                placeholder="https://..."
                value={newSrc}
                onChange={e => setNewSrc(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAdd() }}
              />
              <Button
                type="button"
                onClick={handleAdd}
                disabled={saving}
                style={{ backgroundColor: "#10305a", color: "#fff" }}
                className="shrink-0"
              >
                <Plus className="h-4 w-4 mr-1" /> 新增
              </Button>
            </div>
          </div>
        </div>

        {/* Current items list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-[#10305a]">目前輪播內容（{items.length} 張）</h2>
            {saving && <span className="text-xs text-zinc-400">儲存中…</span>}
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-zinc-400">載入中…</div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-zinc-400">
              尚無內容，請從上方新增圖片或影片
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div
                  key={`${item.src}-${i}`}
                  className="flex items-center gap-3 rounded-xl border bg-background p-3"
                >
                  {/* Preview */}
                  <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-zinc-100 flex items-center justify-center">
                    {item.type === "video" ? (
                      <Video className="h-5 w-5 text-zinc-400" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.src}
                        alt={item.alt}
                        className="w-full h-full object-cover"
                        onError={e => {
                          (e.target as HTMLImageElement).style.display = "none"
                        }}
                      />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        item.type === "video"
                          ? "bg-purple-50 text-purple-600"
                          : "bg-blue-50 text-blue-600"
                      }`}>
                        {item.type === "video" ? "影片" : "圖片"}
                      </span>
                      <span className="text-xs text-zinc-500 truncate">{item.alt}</span>
                    </div>
                    <p className="text-xs text-zinc-400 truncate mt-0.5">{item.src}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMoveUp(i)}
                      disabled={i === 0 || saving}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border text-zinc-400 hover:text-[#10305a] hover:border-[#10305a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="上移"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveDown(i)}
                      disabled={i === items.length - 1 || saving}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border text-zinc-400 hover:text-[#10305a] hover:border-[#10305a] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      aria-label="下移"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(i)}
                      disabled={saving}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border text-zinc-400 hover:text-red-500 hover:border-red-300 disabled:opacity-30 transition-colors"
                      aria-label="刪除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
