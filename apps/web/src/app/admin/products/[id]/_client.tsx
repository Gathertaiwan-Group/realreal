"use client"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TiptapEditor } from "@/components/editor"
import { ProductImageUpload } from "@/components/catalog/ProductImageUpload"
import { createClient } from "@/lib/supabase/client"
import AttributesEditor from "./AttributesEditor"

type Variant = {
  id: string
  name: string
  price: number
  sale_price: number | null
  /** 加購價：此規格的加購價（null = 無加購價）。僅在 is_addon 開啟時生效。 */
  addon_price: number | null
  stock_qty: number
  sku: string | null
  weight: number | null
  attributes: Record<string, string> | null
}

type Category = { id: string; name: string }

/** Convert plain text (with \n line breaks) to basic HTML for TiptapEditor */
function toHtml(text: string): string {
  if (!text) return ""
  if (text.includes("<")) return text // already HTML
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(block => {
      const lines = block.trim().split("\n").filter(Boolean)
      if (lines.length === 0) return ""
      return "<p>" + lines.join("<br>") + "</p>"
    })
    .filter(Boolean)
    .join("\n")
}

type ProductRow = {
  id: string
  name: string
  slug: string
  description?: string | null
  excerpt?: string | null
  category_id?: string | null
  is_active?: boolean | null
  is_addon?: boolean | null
  is_recommended?: boolean | null
  images?: unknown
}

function imageToUrl(img: unknown): string {
  if (typeof img === "string") return img
  if (img && typeof img === "object" && "url" in img) {
    const url = (img as { url?: unknown }).url
    return typeof url === "string" ? url : ""
  }
  return ""
}

export default function AdminProductEditClient({ product }: { product: ProductRow }) {
  const router = useRouter()
  const [images, setImages] = useState<string[]>(
    Array.isArray(product.images)
      ? product.images.map(imageToUrl).filter(Boolean)
      : []
  )
  const [excerpt, setExcerpt] = useState(toHtml(product.excerpt ?? ""))
  const [description, setDescription] = useState(toHtml(product.description ?? ""))
  const [isActive, setIsActive] = useState<boolean>(product.is_active ?? true)
  const [isAddon, setIsAddon] = useState<boolean>(product.is_addon ?? false)
  const [isRecommended, setIsRecommended] = useState<boolean>(product.is_recommended ?? false)
  const [categoryId, setCategoryId] = useState<string>(product.category_id ?? "")
  const [categories, setCategories] = useState<Category[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [variantSaving, setVariantSaving] = useState<string | null>(null)
  // Which toggle is mid-save (null = none). Used to disable the switch while
  // its PATCH is in flight so rapid clicks can't race the persisted value.
  const [togglingField, setTogglingField] = useState<"is_active" | "is_addon" | "is_recommended" | null>(null)

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

  async function getToken(): Promise<string> {
    const supabase = createClient()
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? ""
  }

  // Auto-save a single toggle (上架狀態 / 加購) the moment it flips: optimistic
  // UI update, lightweight PATCH, rollback + toast.error on failure. Guards
  // against rapid re-clicks via togglingField so an in-flight save can't race.
  async function autoSaveToggle(
    field: "is_active" | "is_addon" | "is_recommended",
    next: boolean,
    setLocal: (v: boolean) => void,
    successMsg: string,
  ) {
    if (togglingField) return // a save is already in flight — ignore the click
    const prev = !next
    setLocal(next) // optimistic
    setTogglingField(field)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/products/${product.id}/toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ [field]: next }),
      })
      if (res.ok) {
        toast.success(successMsg)
      } else {
        setLocal(prev) // rollback
        toast.error(`更新失敗 (${res.status})`)
      }
    } catch (err) {
      setLocal(prev) // rollback
      toast.error(`網路錯誤：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTogglingField(null)
    }
  }

  useEffect(() => {
    fetch(`${API_URL}/products/${product.id}/variants`)
      .then(r => r.json())
      .then(j => setVariants(j.data ?? []))
      .catch(() => {})
    fetch(`${API_URL}/categories`)
      .then(r => r.json())
      .then(j => setCategories(j.data ?? []))
      .catch(() => {})
  }, [product.id, API_URL])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const fd = new FormData(e.currentTarget)
    const token = await getToken()

    // Drop blank/whitespace-only entries so empty image fields never reach the
    // API (z.string().url() would 400 on "" / stray values). sort_order is
    // re-indexed after filtering so it stays contiguous from 0.
    const imagesPayload = images
      .map((url) => (typeof url === "string" ? url.trim() : ""))
      .filter((url) => url.length > 0)
      .map((url, i) => ({ url, alt: "", sort_order: i }))

    const body: Record<string, unknown> = {
      name: fd.get("name") as string,
      slug: fd.get("slug") as string,
      description,
      excerpt,
      is_active: isActive,
      is_addon: isAddon,
      is_recommended: isRecommended,
      category_id: categoryId || null,
      images: imagesPayload,
    }
    try {
      const res = await fetch(`${API_URL}/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        router.push("/admin/products")
      } else {
        const errData = await res.json().catch(() => ({}))
        setSaveError(`儲存失敗 (${res.status})：${JSON.stringify(errData)}`)
      }
    } catch (err) {
      setSaveError(`網路錯誤：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleVariantSave(variant: Variant) {
    setVariantSaving(variant.id)
    const token = await getToken()
    await fetch(`${API_URL}/products/${product.id}/variants/${variant.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({
        name: variant.name,
        price: variant.price,
        sale_price: variant.sale_price || null,
        addon_price: variant.addon_price ?? null,
        stock_qty: variant.stock_qty,
        sku: variant.sku || undefined,
        weight: variant.weight,
        attributes: variant.attributes,
      }),
    })
    setVariantSaving(null)
  }

  function updateVariant(
    id: string,
    field: keyof Variant,
    value: string | number | null | Record<string, string>,
  ) {
    setVariants(prev => prev.map(v => v.id === id ? { ...v, [field]: value } : v))
  }

  const fieldClass = "space-y-1"
  const sectionClass = "mt-10 border-t pt-8"

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Link
        href="/admin/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[#10305a] hover:underline"
      >
        <ChevronLeft className="h-4 w-4" />
        回商品列表
      </Link>
      <h1 className="text-2xl font-bold mb-6" style={{ color: "#10305a" }}>編輯商品</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Status switch */}
        <div className="flex items-center gap-3">
          <Label>狀態</Label>
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            disabled={togglingField === "is_active"}
            onClick={() => autoSaveToggle("is_active", !isActive, setIsActive, isActive ? "已下架" : "已上架")}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
              isActive ? "bg-[#10305a]" : "bg-zinc-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                isActive ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className={isActive ? "text-green-600 text-sm" : "text-gray-400 text-sm"}>
            {isActive ? "✓ 上架中" : "✗ 已下架"}
          </span>
        </div>

        {/* Addon flag */}
        <div className="flex items-center gap-3">
          <Label>加購商品</Label>
          <button
            type="button"
            role="switch"
            aria-checked={isAddon}
            disabled={togglingField === "is_addon"}
            onClick={() => autoSaveToggle("is_addon", !isAddon, setIsAddon, isAddon ? "已移出加購區" : "已加入加購區")}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
              isAddon ? "bg-[#10305a]" : "bg-zinc-300"
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              isAddon ? "translate-x-5" : "translate-x-0.5"
            }`} />
          </button>
          <span className={isAddon ? "text-[#10305a] text-sm" : "text-gray-400 text-sm"}>
            {isAddon ? "✓ 顯示於加購區" : "不顯示於加購區"}
          </span>
        </div>
        <p className="-mt-3 text-xs text-gray-400">加購價只在「加入加購區」開啟時生效。</p>

        {/* Recommended flag — drives the cart「你也可能喜歡」strip */}
        <div className="flex items-center gap-3">
          <Label>推薦商品</Label>
          <button
            type="button"
            role="switch"
            aria-checked={isRecommended}
            disabled={togglingField === "is_recommended"}
            onClick={() => autoSaveToggle("is_recommended", !isRecommended, setIsRecommended, isRecommended ? "已移出推薦區" : "已加入推薦區")}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
              isRecommended ? "bg-[#10305a]" : "bg-zinc-300"
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              isRecommended ? "translate-x-5" : "translate-x-0.5"
            }`} />
          </button>
          <span className={isRecommended ? "text-[#10305a] text-sm" : "text-gray-400 text-sm"}>
            {isRecommended ? "✓ 顯示於「你也可能喜歡」" : "不顯示於推薦區"}
          </span>
        </div>
        <p className="-mt-3 text-xs text-gray-400">控制購物車「你也可能喜歡」是否顯示此商品；都沒勾時自動補暢銷商品。</p>

        {/* Name & Slug */}
        <div className={fieldClass}>
          <Label htmlFor="name">商品名稱</Label>
          <Input id="name" name="name" defaultValue={product.name} required className="mt-1" />
        </div>
        <div className={fieldClass}>
          <Label htmlFor="slug">網址代碼（英文小寫＋數字＋連字號／底線）</Label>
          <Input id="slug" name="slug" defaultValue={product.slug} pattern="[a-z0-9_-]+" required className="mt-1" />
        </div>

        {/* Category */}
        <div className={fieldClass}>
          <Label htmlFor="category">商品分類</Label>
          <select
            id="category"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">未分類</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Images */}
        <div className={fieldClass}>
          <Label>商品圖片（可上傳多張，第一張為主圖）</Label>
          <div className="mt-1">
            <ProductImageUpload value={images} onChange={setImages} />
          </div>
        </div>

        {/* Excerpt */}
        <div className={fieldClass}>
          <Label>商品摘要 <span className="text-xs text-gray-400 ml-1">顯示在商品頁右側購買區下方</span></Label>
          <div className="mt-1">
            <TiptapEditor content={excerpt} onChange={setExcerpt} placeholder="簡短說明，例如：五大特色、適合族群…" />
          </div>
        </div>

        {/* Description */}
        <div className={fieldClass}>
          <Label>商品描述 <span className="text-xs text-gray-400 ml-1">顯示於前台商品說明圖上方</span></Label>
          <div className="mt-1">
            <TiptapEditor content={description} onChange={setDescription} placeholder="商品整體說明…" />
          </div>
        </div>

        {saveError && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700 break-all">
            {saveError}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={saving} style={{ backgroundColor: "#10305a", color: "#fff" }}>
            {saving ? "儲存中..." : "更新商品資訊"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>取消</Button>
        </div>
      </form>

      {/* Variants */}
      {variants.length > 0 && (
        <div className={sectionClass}>
          <h2 className="text-lg font-semibold mb-4" style={{ color: "#10305a" }}>價格與庫存</h2>
          <div className="space-y-4">
            {variants.map(v => (
              <div key={v.id} className="border rounded-lg p-4 bg-gray-50 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">規格名稱</Label>
                    <Input className="mt-1" value={v.name} onChange={e => updateVariant(v.id, "name", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">SKU（選填）</Label>
                    <Input className="mt-1" value={v.sku ?? ""} onChange={e => updateVariant(v.id, "sku", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">原價 NT$</Label>
                    <Input type="number" min="0" step="1" className="mt-1" value={v.price}
                      onChange={e => updateVariant(v.id, "price", Number(e.target.value))} />
                  </div>
                  <div>
                    <Label className="text-xs">特價 NT$（留空無特價）</Label>
                    <Input type="number" min="0" step="1" className="mt-1" value={v.sale_price ?? ""}
                      onChange={e => updateVariant(v.id, "sale_price", e.target.value ? Number(e.target.value) : null)}
                      placeholder="無特價" />
                  </div>
                  <div>
                    <Label className="text-xs">加購價 NT$（留空=無加購價）</Label>
                    <Input type="number" min="0" step="1" className="mt-1" value={v.addon_price ?? ""}
                      onChange={e => updateVariant(v.id, "addon_price", e.target.value ? Number(e.target.value) : null)}
                      placeholder="無加購價" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">庫存數量</Label>
                    <Input type="number" min="0" step="1" className="mt-1" value={v.stock_qty}
                      onChange={e => updateVariant(v.id, "stock_qty", Number(e.target.value))} />
                  </div>
                  <div>
                    <Label className="text-xs">重量 (g)</Label>
                    <Input type="number" min="0" step="1" className="mt-1"
                      value={v.weight ?? ""}
                      onChange={e => updateVariant(v.id, "weight", e.target.value ? Number(e.target.value) : null)}
                      placeholder="例 500" />
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-[#10305a]">+ 規格屬性（口味、容量等，前台會顯示）</summary>
                  <div className="mt-2">
                    <AttributesEditor
                      value={v.attributes ?? {}}
                      onChange={(attrs: Record<string, string>) => updateVariant(v.id, "attributes", attrs)}
                    />
                  </div>
                </details>
                <Button type="button" size="sm" disabled={variantSaving === v.id}
                  onClick={() => handleVariantSave(v)}
                  style={{ backgroundColor: "#10305a", color: "#fff" }}>
                  {variantSaving === v.id ? "儲存中..." : "儲存此規格"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
