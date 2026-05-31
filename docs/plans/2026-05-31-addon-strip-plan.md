# Addon Strip Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 加購區 (add-on strip) to product detail page and cart drawer — curated via `is_addon` flag on products, fallback to best_selling.

**Architecture:** DB migration adds `is_addon boolean` → API gains `?is_addon=true` filter → admin product edit gets a toggle → shared `AddonStrip` client component fetches and renders horizontal scrollable cards → mounted in `AddToCartSection` (product page) and `cart-recommendations.ts` (cart drawer).

**Tech Stack:** Supabase SQL migration, Express/Supabase query builder, Next.js 15, React, Zustand cart, Tailwind CSS

---

### Task 1: DB Migration — add `is_addon` column

**Files:**
- Create: `packages/db/migrations/0030_addon_flag.sql`

**Step 1: Create migration file**

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_addon boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_products_is_addon ON products(is_addon) WHERE is_addon = true;
```

**Step 2: Apply to Supabase**

In Supabase dashboard → SQL Editor, paste and run the migration.
Or via CLI: `supabase db push`

**Step 3: Commit**

```bash
git add packages/db/migrations/0030_addon_flag.sql
git commit -m "feat(db): add is_addon flag to products table"
git push origin main
```

---

### Task 2: API — `is_addon` filter on GET /products + PUT /products/:id

**Files:**
- Modify: `apps/api/src/routes/products.ts`

**Step 1: Add `is_addon` to the SELECT fields**

Find this line (~line 102):
```typescript
.select("id, name, slug, description, category_id, images, is_active, is_featured, display_priority, created_at, product_variants(sku, name)", { count: "exact" })
```
Change to:
```typescript
.select("id, name, slug, description, category_id, images, is_active, is_featured, is_addon, display_priority, created_at, product_variants(sku, name)", { count: "exact" })
```

**Step 2: Add `is_addon` query filter**

After the `if (req.query.featured_only === "true")` block, add:
```typescript
if (req.query.is_addon === "true") query = query.eq("is_addon", true)
```

**Step 3: Add `is_addon` to PUT /products/:id**

Find the PUT handler and add `is_addon` to the update payload. Look for where the body is destructured and the supabase `.update()` call is made. Add:
```typescript
if (typeof body.is_addon === "boolean") updatePayload.is_addon = body.is_addon
```
(The exact shape depends on the PUT handler — adapt to match the existing pattern.)

**Step 4: Commit**

```bash
git add apps/api/src/routes/products.ts
git commit -m "feat(api): add is_addon filter to GET /products and PUT /products/:id"
git push origin main
```

---

### Task 3: Admin UI — `is_addon` toggle on product edit page

**Files:**
- Modify: `apps/web/src/app/admin/products/[id]/_client.tsx`

**Step 1: Add state (after `isActive` state, ~line 52)**

```typescript
const [isAddon, setIsAddon] = useState<boolean>(product.is_addon ?? false)
```

**Step 2: Include in PUT body (inside `handleSubmit`, in the `body` object)**

```typescript
is_addon: isAddon,
```

**Step 3: Add toggle UI (after the isActive toggle block)**

```tsx
{/* Addon flag */}
<div className="flex items-center gap-3">
  <Label>加購商品</Label>
  <button
    type="button"
    role="switch"
    aria-checked={isAddon}
    onClick={() => setIsAddon(v => !v)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
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
```

**Step 4: Commit**

```bash
git add apps/web/src/app/admin/products/[id]/_client.tsx
git commit -m "feat(admin): add is_addon toggle to product edit page"
git push origin main
```

---

### Task 4: Create shared `AddonStrip` component

**Files:**
- Create: `apps/web/src/components/product/AddonStrip.tsx`

**Step 1: Create the component**

```tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { useCart } from "@/lib/cart"

interface AddonProduct {
  id: string
  name: string
  slug: string
  variantId: string
  variantName: string
  price: number
  stockQty: number
  imageUrl?: string
}

interface ApiProduct {
  id: string
  name: string
  slug: string
  images?: string[] | null
  default_variant?: { id: string; name: string; price: number | string; stock_qty: number | string } | null
  variants?: Array<{ id: string; name: string; price: number | string; stock_qty: number | string }>
}

async function fetchAddons(
  apiUrl: string,
  excludeVariantIds: string[],
  limit: number,
): Promise<AddonProduct[]> {
  const total = limit + excludeVariantIds.length
  const candidates = [
    `${apiUrl}/products?is_addon=true&limit=${total}`,
    `${apiUrl}/products?sort=best_selling&limit=${total}`,
  ]
  for (const url of candidates) {
    try {
      const res = await fetch(url, { next: { revalidate: 300 } })
      if (!res.ok) continue
      const json = (await res.json()) as { data?: ApiProduct[] }
      const out: AddonProduct[] = []
      for (const p of json.data ?? []) {
        const v = p.default_variant ?? p.variants?.[0]
        if (!v) continue
        if (excludeVariantIds.includes(v.id)) continue
        const price = Number(v.price)
        const stock = Number(v.stock_qty)
        if (!Number.isFinite(price) || stock <= 0) continue
        out.push({
          id: p.id,
          name: p.name,
          slug: p.slug,
          variantId: v.id,
          variantName: v.name,
          price,
          stockQty: stock,
          imageUrl: p.images?.[0],
        })
        if (out.length >= limit) break
      }
      if (out.length > 0) return out
    } catch {
      continue
    }
  }
  return []
}

export function AddonStrip({
  excludeVariantIds = [],
  limit = 6,
  title = "加購區",
}: {
  excludeVariantIds?: string[]
  limit?: number
  title?: string
}) {
  const [products, setProducts] = useState<AddonProduct[]>([])
  const addItem = useCart((s) => s.addItem)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

  useEffect(() => {
    fetchAddons(apiUrl, excludeVariantIds, limit).then(setProducts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (products.length === 0) return null

  return (
    <div className="mt-6 space-y-3">
      <p className="text-sm font-semibold text-zinc-500 border-t pt-4">{title}</p>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 scrollbar-thin">
        {products.map((p) => (
          <div
            key={p.id}
            className="flex shrink-0 w-[140px] flex-col gap-2 rounded-xl border bg-white p-2"
          >
            <Link href={`/shop/${p.slug}`}>
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  className="h-[116px] w-full rounded-lg object-cover"
                />
              ) : (
                <div className="h-[116px] w-full rounded-lg bg-zinc-100 flex items-center justify-center text-xs text-zinc-400">
                  無圖
                </div>
              )}
            </Link>
            <Link href={`/shop/${p.slug}`}>
              <p className="text-xs font-medium leading-snug line-clamp-2 text-[#10305a]">{p.name}</p>
            </Link>
            <div className="flex items-center justify-between gap-1 mt-auto">
              <span className="text-xs font-semibold text-[#10305a]">
                NT$ {p.price.toLocaleString()}
              </span>
              <button
                type="button"
                className="flex h-7 items-center gap-0.5 rounded-lg border border-[#10305a] px-2 text-xs font-medium text-[#10305a] hover:bg-[#10305a] hover:text-white transition-colors"
                onClick={() =>
                  addItem({
                    variantId: p.variantId,
                    productName: p.name,
                    variantName: p.variantName,
                    price: p.price,
                    qty: 1,
                    stockQty: p.stockQty,
                    imageUrl: p.imageUrl,
                  })
                }
                aria-label={`加入 ${p.name}`}
              >
                <Plus className="h-3 w-3" /> 加入
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add apps/web/src/components/product/AddonStrip.tsx
git commit -m "feat(ui): add AddonStrip component — is_addon first, fallback best_selling"
git push origin main
```

---

### Task 5: Product detail page — mount AddonStrip

**Files:**
- Modify: `apps/web/src/components/product/AddToCartSection.tsx`

**Step 1: Import AddonStrip**

At top of file, add:
```tsx
import { AddonStrip } from "./AddonStrip"
```

**Step 2: Render below the add-to-cart button**

The component returns a `<div className="space-y-5">`. At the very end of that div (after the quantity+button row div), add:

```tsx
<AddonStrip
  excludeVariantIds={variants.map((v) => v.id)}
  limit={6}
  title="加購區"
/>
```

**Step 3: Commit**

```bash
git add apps/web/src/components/product/AddToCartSection.tsx
git commit -m "feat(product): mount AddonStrip below add-to-cart button"
git push origin main
```

---

### Task 6: Cart drawer — prefer `is_addon` in recommendation strip

**Files:**
- Modify: `apps/web/src/lib/cart-recommendations.ts`

**Step 1: Replace `fetchRecommendations` body**

The existing function tries `sort=best_selling` then falls back to default. Replace with a version that tries `is_addon=true` first:

```typescript
export async function fetchRecommendations(
  excludeVariantIds: string[] = [],
  limit = 4,
): Promise<RecommendedProduct[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
  const total = limit + excludeVariantIds.length

  const queries = [
    `is_addon=true&limit=${total}`,
    `sort=best_selling&limit=${total}`,
    `limit=${total}`,
  ]

  for (const query of queries) {
    try {
      const products = await fetchProductsList(apiUrl, query)
      const out: RecommendedProduct[] = []
      for (const p of products) {
        const v = p.default_variant ?? p.variants?.[0]
        if (!v) continue
        if (excludeVariantIds.includes(v.id)) continue
        const price = Number(v.price)
        const stock = Number(v.stock_qty)
        if (!Number.isFinite(price) || stock <= 0) continue
        out.push({
          id: p.id,
          name: p.name,
          slug: p.slug,
          variantId: v.id,
          variantName: v.name,
          price,
          stockQty: stock,
          imageUrl: p.images?.[0],
        })
        if (out.length >= limit) break
      }
      if (out.length > 0) return out
    } catch {
      continue
    }
  }
  return []
}
```

**Step 2: Commit**

```bash
git add apps/web/src/lib/cart-recommendations.ts
git commit -m "feat(cart): prefer is_addon products in cart recommendation strip"
git push origin main
```

---

## Summary

| Task | File | Status |
|------|------|--------|
| 1 | `packages/db/migrations/0030_addon_flag.sql` | DB migration |
| 2 | `apps/api/src/routes/products.ts` | API filter |
| 3 | `apps/web/src/app/admin/products/[id]/_client.tsx` | Admin toggle |
| 4 | `apps/web/src/components/product/AddonStrip.tsx` | New component |
| 5 | `apps/web/src/components/product/AddToCartSection.tsx` | Product page |
| 6 | `apps/web/src/lib/cart-recommendations.ts` | Cart drawer |
