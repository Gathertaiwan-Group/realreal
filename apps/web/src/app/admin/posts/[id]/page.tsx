"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { PostForm } from "../_components/PostForm"
import type { Post } from "../_components/PostForm"

export default function EditPostPage() {
  const params = useParams<{ id: string }>()
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    async function fetchPost() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/admin/posts/${params.id}`,
          { headers: { Authorization: `Bearer ${session?.access_token ?? ""}` } }
        )
        if (!res.ok) throw new Error("Failed to fetch post")
        const json = await res.json()
        setPost(json.data ?? json)
      } catch {
        setError("無法載入文章")
      } finally {
        setLoading(false)
      }
    }
    fetchPost()
  }, [params.id])

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-64 bg-gray-200 rounded-[10px]" />
        </div>
      </div>
    )
  }

  if (error || !post) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <p className="text-red-600">{error || "文章不存在"}</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <h1 className="text-2xl font-bold text-[#10305a] mb-6">編輯文章</h1>
      <PostForm mode="edit" initialData={post} />
    </div>
  )
}
