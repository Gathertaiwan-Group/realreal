"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Eye,
  ImageIcon,
  PackagePlus,
  Plus,
  Save,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TiptapEditor } from "@/components/editor"
import { ProductImageUpload } from "@/components/catalog/ProductImageUpload"
import AttributesEditor from "../[id]/AttributesEditor"
import { normalizeAdminCategories } from "@/lib/admin-categories"
import {
  buildProductCreatePayload,
  createEmptyVariant,
  validateProductDraft,
  type ProductImageDraft,
  type ProductVariantDraft,
} from "@/lib/product-create"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

type Category = { id: string; name: string; parent_id: string | null }

function SwitchField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium text-[#10305a]">{label}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[#10305a]" : "bg-zinc-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  )
}

export default function NewProductPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [categoryId, setCategoryId] = useState("")
  const [categories, setCategories] = useState<Category[]>([])
  const [excerpt, setExcerpt] = useState("")
  const [description, setDescription] = useState("")
  const [images, setImages] = useState<ProductImageDraft[]>([])
  const [variants, setVariants] = useState<ProductVariantDraft[]>([
    createEmptyVariant("initial-variant"),
  ])
  const [isActive, setIsActive] = useState(true)
  const [isFeatured, setIsFeatured] = useState(false)
  const [isAddon, setIsAddon] = useState(false)
  const [displayPriority, setDisplayPriority] = useState(0)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    fetch(`${API_URL}/categories`)
      .then((res) => res.json())
      .then((json) => {
        const rows = normalizeAdminCategories(json.data ?? json.categories ?? [])
        setCategories(
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            parent_id: row.parent_id,
          })),
        )
      })
      .catch(() => toast.error("商品分類讀取失敗"))
  }, [])

  useEffect(() => {
    if (slugEdited) return
    const generated = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
    setSlug(generated)
  }, [name, slugEdited])

  const imageUrls = useMemo(() => images.map((image) => image.url), [images])
  const completedSections = [
    Boolean(name.trim() && slug.trim()),
    Boolean(categoryId),
    images.length > 0,
    Boolean(excerpt.trim() || description.trim()),
    variants.length > 0 && variants.every((variant) => variant.name.trim() && variant.price > 0),
  ].filter(Boolean).length

  function syncImageUrls(urls: string[]) {
    setImages((current) =>
      urls.map((url) => current.find((image) => image.url === url) ?? { url, alt: "" }),
    )
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= images.length) return
    setImages((current) => {
      const next = [...current]
      const [image] = next.splice(index, 1)
      next.splice(target, 0, image)
      return next
    })
  }

  function updateVariant(
    clientId: string,
    patch: Partial<ProductVariantDraft>,
  ) {
    setVariants((current) =>
      current.map((variant) =>
        variant.clientId === clientId ? { ...variant, ...patch } : variant,
      ),
    )
  }

  function duplicateVariant(variant: ProductVariantDraft) {
    setVariants((current) => [
      ...current,
      {
        ...variant,
        clientId: crypto.randomUUID(),
        name: `${variant.name} 複製`,
        sku: "",
        attributes: { ...variant.attributes },
      },
    ])
  }

  function removeVariant(clientId: string) {
    if (variants.length === 1) {
      toast.error("至少需要保留一個規格")
      return
    }
    setVariants((current) => current.filter((variant) => variant.clientId !== clientId))
  }

  async function createProduct(publish: boolean) {
    const draft = {
      name,
      slug,
      categoryId,
      excerpt,
      description,
      images,
      isActive: publish ? true : false,
      isFeatured,
      isAddon,
      displayPriority,
      variants,
    }
    const nextErrors = validateProductDraft(draft)
    setErrors(nextErrors)
    if (nextErrors.length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" })
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/admin/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify(buildProductCreatePayload(draft)),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail =
          typeof json.error === "string"
            ? json.error
            : JSON.stringify(json.error ?? json.details ?? json)
        throw new Error(detail || "建立商品失敗")
      }

      toast.success(publish ? "商品已建立並上架" : "商品草稿已建立")
      router.push(`/admin/products/${json.data.product.id}`)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "建立商品失敗"])
      window.scrollTo({ top: 0, behavior: "smooth" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-zinc-500">商品管理 / 新增商品</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#10305a]">建立完整商品</h1>
          <p className="mt-2 text-sm text-zinc-500">
            一次設定商品內容、圖片、價格、庫存與所有規格。
          </p>
        </div>
        <div className="rounded-full bg-[#10305a]/5 px-4 py-2 text-sm text-[#10305a]">
          完成度 {completedSections}/5
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mb-6 rounded-[10px] border border-red-200 bg-red-50 p-4">
          <p className="font-medium text-red-800">請先修正以下問題：</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl text-[#10305a]">基本資料</CardTitle>
              <CardDescription>商品名稱、網址與分類會影響前台導覽及搜尋。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="name">商品名稱 *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例：30 天植物蛋白自選組合"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">網址代碼 *</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(event) => {
                    setSlugEdited(true)
                    setSlug(event.target.value.toLowerCase())
                  }}
                  placeholder="protein-30pack-mix"
                />
                <p className="text-xs text-zinc-500">英文小寫、數字與連字號。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">商品分類</Label>
                <select
                  id="category"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">未分類</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.parent_id ? "↳ " : ""}
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl text-[#10305a]">
                <ImageIcon className="h-5 w-5" />
                商品圖片
              </CardTitle>
              <CardDescription>第一張為主圖，可調整順序並補上圖片說明。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProductImageUpload value={imageUrls} onChange={syncImageUrls} />
              {images.map((image, index) => (
                <div key={image.url} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                  <span className="w-20 shrink-0 text-xs font-medium text-zinc-500">
                    {index === 0 ? "主圖" : `圖片 ${index + 1}`}
                  </span>
                  <Input
                    value={image.alt}
                    onChange={(event) =>
                      setImages((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, alt: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="圖片說明（無障礙與 SEO）"
                  />
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" size="icon" variant="outline" onClick={() => moveImage(index, -1)} disabled={index === 0}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="icon" variant="outline" onClick={() => moveImage(index, 1)} disabled={index === images.length - 1}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl text-[#10305a]">商品內容</CardTitle>
              <CardDescription>摘要顯示於購買區，完整描述顯示於商品說明。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>商品摘要</Label>
                <TiptapEditor
                  content={excerpt}
                  onChange={setExcerpt}
                  placeholder="特色、適合族群、優惠說明…"
                />
              </div>
              <div className="space-y-2">
                <Label>完整商品描述</Label>
                <TiptapEditor
                  content={description}
                  onChange={setDescription}
                  placeholder="成分、食用方式、營養資訊、保存方式…"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl text-[#10305a]">價格、規格與庫存</CardTitle>
                  <CardDescription className="mt-1">
                    每個商品至少需要一個規格；SKU 建議保持唯一。
                  </CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVariants((current) => [...current, createEmptyVariant()])}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  新增規格
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {variants.map((variant, index) => (
                <div key={variant.clientId} className="rounded-[10px] border bg-zinc-50/60 p-4">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="font-medium text-[#10305a]">規格 {index + 1}</p>
                    <div className="flex gap-1">
                      <Button type="button" size="sm" variant="ghost" onClick={() => duplicateVariant(variant)}>
                        <Copy className="mr-1 h-4 w-4" />
                        複製
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="text-red-600" onClick={() => removeVariant(variant.clientId)}>
                        <Trash2 className="mr-1 h-4 w-4" />
                        刪除
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>規格名稱 *</Label>
                      <Input value={variant.name} onChange={(event) => updateVariant(variant.clientId, { name: event.target.value })} placeholder="例：30 包綜合口味" />
                    </div>
                    <div className="space-y-2">
                      <Label>SKU</Label>
                      <Input value={variant.sku} onChange={(event) => updateVariant(variant.clientId, { sku: event.target.value })} placeholder="PROTEIN-30-MIX" />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-2">
                      <Label>原價 NT$ *</Label>
                      <Input type="number" min="0" step="1" value={variant.price || ""} onChange={(event) => updateVariant(variant.clientId, { price: Number(event.target.value) })} />
                    </div>
                    <div className="space-y-2">
                      <Label>特價 NT$</Label>
                      <Input type="number" min="0" step="1" value={variant.salePrice ?? ""} onChange={(event) => updateVariant(variant.clientId, { salePrice: event.target.value ? Number(event.target.value) : null })} placeholder="無特價" />
                    </div>
                    <div className="space-y-2">
                      <Label>庫存數量</Label>
                      <Input type="number" min="0" step="1" value={variant.stockQty} onChange={(event) => updateVariant(variant.clientId, { stockQty: Number(event.target.value) })} />
                    </div>
                    <div className="space-y-2">
                      <Label>重量 (g)</Label>
                      <Input type="number" min="0" step="0.001" value={variant.weight ?? ""} onChange={(event) => updateVariant(variant.clientId, { weight: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                  </div>
                  <details className="mt-4 rounded-lg border bg-white p-3">
                    <summary className="cursor-pointer text-sm font-medium text-[#10305a]">
                      規格屬性（口味、容量、包數等）
                    </summary>
                    <AttributesEditor
                      value={variant.attributes}
                      onChange={(attributes) => updateVariant(variant.clientId, { attributes })}
                    />
                  </details>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-[#10305a]">發布設定</CardTitle>
              <CardDescription>建立前確認商品在前台的顯示方式。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SwitchField
                label="上架商品"
                description="建立完成後立即在前台顯示。"
                checked={isActive}
                onChange={setIsActive}
              />
              <SwitchField
                label="首頁精選"
                description="顯示於首頁精選商品區。"
                checked={isFeatured}
                onChange={setIsFeatured}
              />
              <SwitchField
                label="加購商品"
                description="允許顯示於結帳加購區。"
                checked={isAddon}
                onChange={setIsAddon}
              />
              <div className="space-y-2 pt-2">
                <Label htmlFor="priority">顯示排序權重</Label>
                <Input
                  id="priority"
                  type="number"
                  min="0"
                  max="99999"
                  value={displayPriority}
                  onChange={(event) => setDisplayPriority(Number(event.target.value))}
                />
                <p className="text-xs text-zinc-500">數字越大，商品排序越前面。</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-[#10305a]">建立前檢查</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[
                ["基本資料", Boolean(name.trim() && slug.trim())],
                ["商品分類", Boolean(categoryId)],
                ["商品圖片", images.length > 0],
                ["商品內容", Boolean(excerpt.trim() || description.trim())],
                ["價格與庫存", variants.every((variant) => variant.name.trim() && variant.price > 0)],
              ].map(([label, complete]) => (
                <div key={String(label)} className="flex items-center justify-between">
                  <span className="text-zinc-600">{label}</span>
                  <CheckCircle2 className={`h-4 w-4 ${complete ? "text-green-600" : "text-zinc-300"}`} />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Button
              type="button"
              className="w-full bg-[#10305a] text-white hover:bg-[#10305a]/90"
              disabled={saving}
              onClick={() => createProduct(isActive)}
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              {saving ? "建立中…" : isActive ? "建立並上架" : "建立商品"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={saving}
              onClick={() => createProduct(false)}
            >
              <Save className="mr-2 h-4 w-4" />
              儲存為草稿
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={saving}
              onClick={() => router.push("/admin/products")}
            >
              <Eye className="mr-2 h-4 w-4" />
              返回商品列表
            </Button>
          </div>
        </aside>
      </div>
    </div>
  )
}
