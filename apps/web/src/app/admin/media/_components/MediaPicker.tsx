"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Search, Upload, ImageIcon, X, Check } from "lucide-react"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"

interface MediaItem {
  id: string
  url: string
  filename: string
  size: number
  alt_text: string | null
  mime_type: string
  created_at: string
}

interface MediaPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (url: string) => void
}

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export function MediaPicker({ open, onOpenChange, onSelect }: MediaPickerProps) {
  const [tab, setTab] = useState<"browse" | "upload">("browse")
  const [items, setItems] = useState<MediaItem[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)

  // Upload state
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [dragging, setDragging] = useState(false)

  const fetchMedia = useCallback(async () => {
    setLoading(true)
    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
    try {
      const res = await adminFetch(`${API_URL}/admin/media`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.media ?? [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchMedia()
      setSearch("")
      setTab("browse")
    }
  }, [open, fetchMedia])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, onOpenChange])

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  const filtered = items.filter(
    (item) =>
      item.filename.toLowerCase().includes(search.toLowerCase()) ||
      (item.alt_text?.toLowerCase().includes(search.toLowerCase()) ?? false),
  )

  function handleSelect(item: MediaItem) {
    onSelect(item.url)
    onOpenChange(false)
  }

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("僅支援圖片格式")
        return
      }
      if (file.size > MAX_SIZE) {
        toast.error("檔案大小不得超過 10MB")
        return
      }

      setUploading(true)
      setProgress(0)

      const API_URL =
        process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
      const formData = new FormData()
      formData.append("file", file)

      try {
        const xhr = new XMLHttpRequest()

        const result = await new Promise<string>((resolve, reject) => {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 100))
            }
          })

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText)
                resolve(data.url ?? "")
              } catch {
                resolve("")
              }
            } else {
              reject(new Error(`上傳失敗 (${xhr.status})`))
            }
          })

          xhr.addEventListener("error", () => reject(new Error("網路錯誤")))
          xhr.addEventListener("abort", () => reject(new Error("上傳已取消")))

          xhr.open("POST", `${API_URL}/admin/media/upload`)
          xhr.send(formData)
        })

        toast.success("上傳成功")

        // If we got a URL back, select it immediately
        if (result) {
          onSelect(result)
          onOpenChange(false)
        } else {
          // Refresh the list and switch to browse tab
          await fetchMedia()
          setTab("browse")
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上傳失敗")
      } finally {
        setUploading(false)
        setProgress(0)
      }
    },
    [fetchMedia, onSelect, onOpenChange],
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white rounded-[10px] shadow-xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <h2 className="text-base font-semibold text-[#10305a]">
            選擇媒體
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1 rounded-[10px] hover:bg-zinc-100 transition-colors"
          >
            <X className="w-4 h-4 text-[#687279]" />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b px-5 shrink-0">
          <button
            onClick={() => setTab("browse")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "browse"
                ? "border-[#10305a] text-[#10305a]"
                : "border-transparent text-[#687279] hover:text-[#10305a]"
            }`}
          >
            媒體庫
          </button>
          <button
            onClick={() => setTab("upload")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "upload"
                ? "border-[#10305a] text-[#10305a]"
                : "border-transparent text-[#687279] hover:text-[#10305a]"
            }`}
          >
            上傳新檔案
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "browse" && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#687279]" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜尋檔案名稱或替代文字..."
                  className="pl-9"
                />
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16 text-[#687279]">
                  <div className="animate-spin w-5 h-5 border-2 border-[#10305a] border-t-transparent rounded-full" />
                  <span className="ml-2 text-sm">載入中...</span>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-[#687279]">
                  <ImageIcon className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">
                    {search ? "找不到符合的媒體" : "尚無媒體檔案"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {filtered.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className="group relative rounded-[10px] overflow-hidden border hover:ring-2 hover:ring-[#10305a] transition-shadow focus:outline-none focus:ring-2 focus:ring-[#10305a]"
                    >
                      <div className="relative aspect-square bg-zinc-100">
                        <Image
                          src={item.url}
                          alt={item.alt_text ?? item.filename}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 33vw, 25vw"
                        />
                      </div>
                      <div className="absolute inset-0 bg-[#10305a]/0 group-hover:bg-[#10305a]/20 transition-colors flex items-center justify-center">
                        <Check className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
                      </div>
                      <p className="text-[10px] text-[#687279] truncate px-1.5 py-1">
                        {item.filename}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "upload" && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const file = e.dataTransfer.files[0]
                if (file) uploadFile(file)
              }}
              onClick={() => !uploading && inputRef.current?.click()}
              className={`
                flex flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed
                px-6 py-16 cursor-pointer transition-colors
                ${
                  dragging
                    ? "border-[#10305a] bg-[#10305a]/5"
                    : "border-zinc-300 hover:border-[#10305a]/50 hover:bg-zinc-50"
                }
                ${uploading ? "pointer-events-none opacity-70" : ""}
              `}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadFile(file)
                  e.target.value = ""
                }}
              />

              {uploading ? (
                <div className="w-full max-w-xs space-y-3 text-center">
                  <ImageIcon className="w-8 h-8 mx-auto text-[#10305a] animate-pulse" />
                  <p className="text-sm text-[#687279]">
                    上傳中... {progress}%
                  </p>
                  <Progress value={progress} className="h-2" />
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-[#687279]" />
                  <p className="text-sm text-[#687279]">
                    拖放圖片到這裡，或{" "}
                    <span className="font-medium text-[#10305a] underline underline-offset-2">
                      點擊上傳
                    </span>
                  </p>
                  <p className="text-xs text-[#687279]/60">
                    支援 JPG, PNG, GIF, WebP，最大 10MB
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t bg-zinc-50 shrink-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </div>
      </div>
    </div>
  )
}