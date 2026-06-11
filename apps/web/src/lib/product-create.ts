export interface ProductImageDraft {
  url: string
  alt: string
}

export interface ProductVariantDraft {
  clientId: string
  name: string
  sku: string
  price: number
  salePrice: number | null
  stockQty: number
  weight: number | null
  attributes: Record<string, string>
}

export interface ProductCreateDraft {
  name: string
  slug: string
  categoryId: string
  excerpt: string
  description: string
  images: ProductImageDraft[]
  isActive: boolean
  isFeatured: boolean
  isAddon: boolean
  displayPriority: number
  variants: ProductVariantDraft[]
}

export function createEmptyVariant(clientId = crypto.randomUUID()): ProductVariantDraft {
  return {
    clientId,
    name: "預設規格",
    sku: "",
    price: 0,
    salePrice: null,
    stockQty: 0,
    weight: null,
    attributes: {},
  }
}

export function validateProductDraft(draft: ProductCreateDraft): string[] {
  const errors: string[] = []
  if (!draft.name.trim()) errors.push("請輸入商品名稱")
  if (!/^[a-z0-9-]+$/.test(draft.slug.trim())) {
    errors.push("網址代碼只能使用英文小寫、數字與連字號")
  }
  if (draft.variants.length === 0) errors.push("至少需要一個商品規格")

  const seenSkus = new Set<string>()
  for (const variant of draft.variants) {
    const label = variant.name.trim() || "未命名規格"
    if (!variant.name.trim()) errors.push("每個規格都需要名稱")
    if (!(variant.price > 0)) errors.push(`規格「${label}」的原價必須大於 0`)
    if (variant.salePrice != null && variant.salePrice > variant.price) {
      errors.push(`規格「${label}」的特價不可高於原價`)
    }
    const sku = variant.sku.trim().toUpperCase()
    if (sku) {
      if (seenSkus.has(sku)) errors.push(`SKU「${sku}」重複`)
      seenSkus.add(sku)
    }
  }
  return errors
}

export function buildProductCreatePayload(draft: ProductCreateDraft) {
  return {
    product: {
      name: draft.name.trim(),
      slug: draft.slug.trim(),
      category_id: draft.categoryId || null,
      excerpt: draft.excerpt,
      description: draft.description,
      images: draft.images.map((image, index) => ({
        url: image.url,
        alt: image.alt.trim(),
        sort_order: index,
      })),
      is_active: draft.isActive,
      is_featured: draft.isFeatured,
      is_addon: draft.isAddon,
      display_priority: draft.displayPriority,
    },
    variants: draft.variants.map((variant) => ({
      name: variant.name.trim(),
      sku: variant.sku.trim() || undefined,
      price: variant.price,
      sale_price: variant.salePrice,
      stock_qty: variant.stockQty,
      weight: variant.weight,
      attributes: variant.attributes,
    })),
  }
}
