"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { adminFetch } from "@/lib/admin-fetch"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

type Review = {
  id: string
  product_id: string
  rating: number
  content: string
  author_name: string
  author_email: string
  is_approved: boolean
  created_at: string
  products: { name: string } | null
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} style={{ color: star <= rating ? "#f59e0b" : "#d1d5db" }}>
          &#9733;
        </span>
      ))}
    </span>
  )
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ReviewsTable({ reviews: initialReviews, token }: { reviews: Review[]; token: string }) {
  const [reviews, setReviews] = useState(initialReviews)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleToggle(id: string) {
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/reviews/${id}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const json = await res.json()
          setReviews((prev) =>
            prev.map((r) => (r.id === id ? { ...r, is_approved: json.data.is_approved } : r))
          )
        }
      } catch {
        // ignore
      }
    })
  }

  function handleDelete(id: string) {
    if (!confirm("確定要刪除這則評價？")) return
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/reviews/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          setReviews((prev) => prev.filter((r) => r.id !== id))
          router.refresh()
        }
      } catch {
        // ignore
      }
    })
  }

  return (
    <div className="border rounded-[10px] overflow-hidden">
      {/* Table Header */}
      <div className="hidden md:grid grid-cols-[140px_100px_80px_1fr_140px_80px_80px] gap-4 px-4 py-3 bg-gray-50 text-xs font-medium text-[#687279] uppercase">
        <span>商品</span>
        <span>評論者</span>
        <span>評分</span>
        <span>內容</span>
        <span>日期</span>
        <span>狀態</span>
        <span className="text-right">操作</span>
      </div>

      <div className="divide-y">
        {reviews.length === 0 && (
          <p className="p-8 text-center text-[#687279]">尚無評價</p>
        )}
        {reviews.map((review) => (
          <div
            key={review.id}
            className="grid grid-cols-1 md:grid-cols-[140px_100px_80px_1fr_140px_80px_80px] gap-2 md:gap-4 items-center px-4 py-3 hover:bg-gray-50/50 transition-colors"
          >
            <span className="text-sm text-[#10305a] font-medium truncate">
              {review.products?.name ?? "-"}
            </span>
            <span className="text-sm text-[#687279] truncate" title={review.author_email}>
              {review.author_name}
            </span>
            <div>
              <StarRating rating={review.rating} />
            </div>
            <span className="text-sm text-[#687279] truncate" title={review.content}>
              {review.content.length > 50 ? review.content.slice(0, 50) + "..." : review.content}
            </span>
            <span className="text-sm text-[#687279]">
              {formatDate(review.created_at)}
            </span>
            <div>
              <button
                onClick={() => handleToggle(review.id)}
                disabled={isPending}
                className="inline-block"
              >
                <Badge variant={review.is_approved ? "default" : "secondary"}>
                  {review.is_approved ? "已核准" : "待審核"}
                </Badge>
              </button>
            </div>
            <div className="flex items-center justify-end">
              <Button
                variant="outline"
                size="sm"
                className="rounded-[10px] text-red-600 hover:bg-red-50 hover:text-red-700 border-red-200"
                onClick={() => handleDelete(review.id)}
                disabled={isPending}
              >
                刪除
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}