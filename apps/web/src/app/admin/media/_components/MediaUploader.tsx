"use client"

import { useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Progress } from "@/components/ui/progress"
import { Upload, ImageIcon } from "lucide-react"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export function MediaUploader() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

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

        await new Promise<void>((resolve, reject) => {
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 100))
            }
          })

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve()
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
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上傳失敗")
      } finally {
        setUploading(false)
        setProgress(0)
      }
    },
    [router],
  )

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    // Reset so the same file can be selected again
    e.target.value = ""
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
      className={`
        relative flex flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed
        px-6 py-10 cursor-pointer transition-colors
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
        onChange={handleInputChange}
      />

      {uploading ? (
        <div className="w-full max-w-xs space-y-3 text-center">
          <ImageIcon className="w-8 h-8 mx-auto text-[#10305a] animate-pulse" />
          <p className="text-sm text-[#687279]">上傳中... {progress}%</p>
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
  )
}