"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TiptapEditor } from "@/components/editor"
import { ProductImageUpload } from "@/components/catalog/ProductImageUpload"

export default function NewProductPage() {
  const router = useRouter()
  const [images, setImages] = useState<string[]>([])
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const fd = new FormData(e.currentTarget)
    const body = {
      name: fd.get("name") as string,
      slug: fd.get("slug") as string,
      description,
      images,
      is_active: true,
    }
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/products`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify(body),
    })
    if (res.ok) router.push("/admin/products")
    else setSaving(false)
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">新增商品</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div><Label htmlFor="name">商品名稱</Label><Input id="name" name="name" required /></div>
        <div><Label htmlFor="slug">網址代碼</Label><Input id="slug" name="slug" pattern="[a-z0-9-]+" required /></div>
        <div><Label>商品描述</Label><TiptapEditor content={description} onChange={setDescription} placeholder="輸入商品描述..." /></div>
        <div><Label>商品圖片</Label><ProductImageUpload value={images} onChange={setImages} /></div>
        <Button type="submit" disabled={saving}>{saving ? "儲存中..." : "建立商品"}</Button>
      </form>
    </div>
  )
}
