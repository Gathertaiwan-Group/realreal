"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ImageIcon, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"

export interface MediaItem {
  id: string
  url: string
  filename: string
  size: number
  alt_text: string | null
  mime_type: string
  created_at: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

interface MediaGridProps {
  items: MediaItem[]
}

export function MediaGrid({ items }: MediaGridProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<MediaItem | null>(null)
  const [altText, setAltText] = useState("")
  const [deleting, setDeleting] = useState(false)

  function handleSelect(item: MediaItem) {
    setSelected(item)
    setAltText(item.alt_text ?? "")
  }

  function handleClose() {
    setSelected(null)
    setAltText("")
  }

  async function handleSaveAlt() {
    if (!selected) return
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
    try {
      const res = await adminFetch(`${API_URL}/admin/media/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alt_text: altText }),
      })
      if (!res.ok) throw new Error("更新失敗")
      toast.success("已更新替代文字")
      router.refresh()
      handleClose()
    } catch {
      toast.error("更新替代文字失敗")
    }
  }

  async function handleDelete() {
    if (!selected) return
    setDeleting(true)
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
    try {
      const res = await adminFetch(`${API_URL}/admin/media/${selected.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("刪除失敗")
      toast.success("已刪除媒體檔案")
      router.refresh()
      handleClose()
    } catch {
      toast.error("刪除媒體檔案失敗")
    } finally {
      setDeleting(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[#687279]">
        <ImageIcon className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-sm">尚無媒體檔案</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {items.map((item) => (
          <Card
            key={item.id}
            className="group cursor-pointer overflow-hidden hover:ring-2 hover:ring-[#10305a]/30 transition-shadow"
            onClick={() => handleSelect(item)}
          >
            <div className="relative aspect-square bg-zinc-100">
              <Image
                src={item.url}
                alt={item.alt_text ?? item.filename}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 50vw, (max-width: 1024px) 25vw, 16vw"
              />
            </div>
            <div className="p-2 space-y-0.5">
              <p className="text-xs font-medium text-[#10305a] truncate">
                {item.filename}
              </p>
              <div className="flex items-center justify-between text-[10px] text-[#687279]">
                <span>{formatBytes(item.size)}</span>
                <span>{formatDate(item.created_at)}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Detail overlay */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-[10px] shadow-xl w-full max-w-lg mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-base font-semibold text-[#10305a]">
                媒體詳情
              </h2>
              <button
                onClick={handleClose}
                className="p-1 rounded-[10px] hover:bg-zinc-100 transition-colors"
              >
                <X className="w-4 h-4 text-[#687279]" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="relative aspect-video bg-zinc-100 rounded-[10px] overflow-hidden">
                <Image
                  src={selected.url}
                  alt={selected.alt_text ?? selected.filename}
                  fill
                  className="object-contain"
                />
              </div>

              <div className="text-sm space-y-1 text-[#687279]">
                <p>
                  <span className="font-medium text-[#10305a]">檔案名稱：</span>
                  {selected.filename}
                </p>
                <p>
                  <span className="font-medium text-[#10305a]">檔案大小：</span>
                  {formatBytes(selected.size)}
                </p>
                <p>
                  <span className="font-medium text-[#10305a]">上傳日期：</span>
                  {formatDate(selected.created_at)}
                </p>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="alt-text"
                  className="text-sm font-medium text-[#10305a]"
                >
                  替代文字 (alt text)
                </label>
                <Input
                  id="alt-text"
                  value={altText}
                  onChange={(e) => setAltText(e.target.value)}
                  placeholder="描述這張圖片..."
                />
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t bg-zinc-50">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? "刪除中..." : "刪除"}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleClose}>
                  取消
                </Button>
                <Button size="sm" onClick={handleSaveAlt}>
                  儲存
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}