# Admin 商品編輯器清理：移除三欄 + 補上分類/上下架/重量/屬性

**Date:** 2026-05-30
**Status:** Draft → pending user review
**Touches:** packages/db (1 migration), apps/api (1 route file), apps/web (3 files), lib (1 type def)
**Scope:** small/focused — ~300 LOC

## Why

Admin 商品編輯器 (`/admin/products/[id]`) 目前 7 個區塊裡：
- **3 個是廢欄** — 「前台商品詳細內容（三欄）」shop_left/middle/right 早在前一輪改版已把前台改成 9 張共用商說圖 (`/product-info/6-14.jpg`)，三欄 HTML 內容不再 render，但編輯器仍然要 admin 填 + DB 持續儲存（每商品 3 個 TipTap 富文字編輯器、26/31 商品都有資料）。
- **4 個關鍵欄位 admin 改不到**：
  - `category_id`（商品分類）→ 商品歸類後在後台無法修改
  - `is_active`（上下架）→ 無法暫時下架，只能刪除
  - `product_variants.weight` → 重量沒地方填，未來接 ECPay 報價無資料
  - `product_variants.attributes` JSONB → 規格屬性無 UI

業務影響：admin 每次新增/編輯商品都花時間在沒人看的三欄；分類錯了得登 SQL；下架商品得整個刪掉風險高。

## Decisions (locked with user 2026-05-30)

1. **三欄處理方式 = B2**：DROP COLUMN（連同 26 筆 / 78 欄資料永久消失）— 不備份。User 確認過內容已被 9 張商說圖取代、不要了。
2. **新增 4 個欄位全做**：分類 dropdown + 上下架 toggle + variant 重量 + variant attributes。

## Scope

### IN
1. Migration 0018 DROP `products.shop_left`, `shop_middle`, `shop_right`
2. 編輯器 UI 砍 3 個 TipTap 區塊
3. 編輯器 UI 加 4 個新欄
4. API zod schema 同步（出 3 進 4）
5. 前台 `/shop/[slug]` 砍 `hasShopColumns` gate（description 改成永遠顯示）
6. lib/catalog.ts Product type 同步
7. 確認 `/shop` 列表 + `/shop/[slug]` 詳細頁有 `is_active=true` filter（若無補上）

### OUT
- **前台 variant selector 改造**（顯示中文屬性名）— attributes 寫得進 DB 但前台展示另案
- **新增商品流程**（如果有獨立的 /admin/products/new）— 本案只動編輯頁；若創建頁共用 _client.tsx 則一起順帶；若獨立檔則記下待補（implementation 時 grep 確認）
- **分類 CRUD**（管理分類本身）— 不在本案 scope
- **批次操作**（多商品同時上下架）— 不在本案

## Design

### Section 1 — Migration 0018

`packages/db/migrations/0018_drop_product_shop_columns.sql`：
```sql
-- Drop legacy three-column rich text fields.
-- These columns were replaced by 9 shared shop info images
-- (/product-info/6-14.jpg) rendered in apps/web/src/app/shop/[slug]/page.tsx.
-- Admin filled them but they were never rendered. 26/31 products have data
-- in these columns; user explicitly approved permanent deletion 2026-05-30.
ALTER TABLE products
  DROP COLUMN IF EXISTS shop_left,
  DROP COLUMN IF EXISTS shop_middle,
  DROP COLUMN IF EXISTS shop_right;
```

`product_variants.weight` 和 `attributes` 在 0001_initial.sql 早已存在（line 50/52），不用 migration。

### Section 2 — apps/api/src/routes/products.ts

PUT `/products/:id` zod schema 改動：

**砍 3 個：**
```ts
shop_left: z.string().optional(),     // remove
shop_middle: z.string().optional(),   // remove
shop_right: z.string().optional(),    // remove
```

**加 2 個（product-level）：**
```ts
category_id: z.string().uuid().nullable().optional(),
is_active: z.boolean().optional(),
```

PUT `/products/:id/variants/:vid` zod 改動 **加 2 個**：
```ts
weight: z.number().nonnegative().nullable().optional(),
attributes: z.record(z.string(), z.string()).nullable().optional(),  // simple key→string map
```

GET endpoints — 確認回傳含 `category_id, is_active, variant.weight, variant.attributes`，不需新增 select（這些都是 `*` 預設帶出）。

### Section 3 — apps/web/src/app/admin/products/[id]/_client.tsx

砍：
- line 45-47：useState shopLeft/Middle/Right
- line 81-83：payload 帶 shop_*
- line 168-195：整段「前台商品詳細內容（三欄）」 + 3 個 TipTap

加（在表單裡，位置如下）：

**最上方（商品名稱旁邊）— 上下架 Switch**：
```tsx
<div className="flex items-center gap-3">
  <Label>狀態</Label>
  <Switch checked={isActive} onCheckedChange={setIsActive} />
  <span className={isActive ? "text-green-600" : "text-gray-400"}>
    {isActive ? "✓ 上架中" : "✗ 已下架"}
  </span>
</div>
```

**網址代碼下方 — 分類 dropdown**：
```tsx
<div className={fieldClass}>
  <Label htmlFor="category">商品分類</Label>
  <Select value={categoryId} onValueChange={setCategoryId}>
    <option value="">未分類</option>
    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
  </Select>
</div>
```
需要 fetch `/categories` 載入 categories；在 useEffect 中跟 variants 同步抓。

**商品描述 hint 改寫**：
```tsx
<Label>商品描述 <span className="text-xs text-gray-400 ml-1">顯示於前台商品說明圖上方</span></Label>
```
（原本「僅在無三欄內容時顯示」改成「顯示於前台商品說明圖上方」）

**每個 variant row 加 weight + attributes：**

variant 區塊原本 grid-cols-3（原價 / 特價 / 庫存）。改成 grid-cols-4 加重量：
```tsx
<div className="grid grid-cols-4 gap-3">
  ...原價、特價、庫存
  <div>
    <Label className="text-xs">重量 (g)</Label>
    <Input type="number" min="0" step="1" className="mt-1"
      value={v.weight ?? ""}
      onChange={e => updateVariant(v.id, "weight", e.target.value ? Number(e.target.value) : null)}
      placeholder="例 500" />
  </div>
</div>
```

variant 下方加「規格屬性」摺疊：
```tsx
<details className="mt-2">
  <summary className="cursor-pointer text-xs text-[#10305a]">+ 規格屬性（口味、容量等，前台會顯示）</summary>
  <AttributesEditor
    value={v.attributes ?? {}}
    onChange={(attrs) => updateVariant(v.id, "attributes", attrs)} />
</details>
```

`AttributesEditor`（新 component）= 簡單 key-value rows + 「+」「✕」按鈕。位置：`apps/web/src/app/admin/products/[id]/AttributesEditor.tsx`（local component；不放共用 components）。

handleVariantSave 同時送 `weight` + `attributes`。

### Section 4 — apps/web/src/app/shop/[slug]/page.tsx

砍：
- line 100：`const hasShopColumns = product.shop_left || product.shop_middle || product.shop_right`
- line 174 條件：`{product.description && !hasShopColumns && (...)}` → 改成 `{product.description && (...)}`

### Section 5 — apps/web/src/lib/catalog.ts

`Product` type 砍 3 欄：
```ts
// remove: shop_left: string | null; shop_middle: string | null; shop_right: string | null;
```

加 variant attributes 型別（如 Variant type 在這檔）：
```ts
weight?: number | null
attributes?: Record<string, string> | null
```

### Section 6 — 前台 is_active filter 確認

兩個地方 grep + 確認：
- `apps/web/src/lib/catalog.ts` 列表查詢 → 應已有 `.eq("is_active", true)`，若無補
- `apps/web/src/app/shop/[slug]/page.tsx` 詳細頁查詢 → 若 product.is_active=false 應回 404 / not found

實作時 grep `is_active` 在 apps/web 內，缺哪補哪。

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0018_drop_product_shop_columns.sql` |
| 改 | `apps/api/src/routes/products.ts`（zod schema 3 出 2 進 product + 2 進 variant） |
| 改 | `apps/web/src/app/admin/products/[id]/_client.tsx`（砍 3 TipTap、加 4 新欄、fetch categories） |
| 新 | `apps/web/src/app/admin/products/[id]/AttributesEditor.tsx`（key-value 編輯 component） |
| 改 | `apps/web/src/app/shop/[slug]/page.tsx`（砍 hasShopColumns gate） |
| 改 | `apps/web/src/lib/catalog.ts`（type 出 3 進 2） |
| 改/驗 | apps/web 其他位置（grep `is_active`，補 filter 若缺） |

預估 ~300 lines changed (mostly _client.tsx)、~50 lines new (AttributesEditor)、1 migration。

## Validation

1. `npm run build` apps/api / `next build` apps/web 雙綠
2. `npm test` apps/api 仍是「34/34 new tests pass + 18 pre-existing failures」（不增不減）
3. Migration 0018 套到 Supabase（透過 Management API，沿用 0016/0017 模式）
4. Railway api / Vercel web push 觸發 auto deploy
5. Smoke：
   - 進 admin 編輯任一商品 → 看到分類 dropdown + 上下架 switch + 變更後存得進 DB
   - 三欄 TipTap 不再出現
   - 商品設成 is_active=false → 前台 /shop 列表不顯示、/shop/[slug] 404
   - 任一 variant 填 weight=500 + attributes={口味:芝麻} → 存得進 DB、再次開編輯器可見

## Known caveats

- DROP COLUMN 不可逆 — 26 商品 × 3 欄資料消失。User 已 explicit OK。
- `attributes` JSONB key-value 編輯器是極簡版（key + value 都當 string）。如要支援 number / boolean / array 等型別、或下拉選單型 attribute（如 spec ranges），需另案。
- 前台 variant selector 仍只顯示 `variant.name`，新填的 attributes 不會自動 render（避免破壞既有顯示）；前台 UI 改造另案。
- 「新增商品」流程若有獨立 `/admin/products/new/page.tsx`，本 spec 預期一併套用（implementation 時 grep 確認）。若該檔案不存在（創建用 _client.tsx 共用）則自動覆蓋。
