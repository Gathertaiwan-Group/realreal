# Spec B — 前台商品顯示後台可控（精選 + 排序）

**Date:** 2026-05-30
**Status:** Draft → pending user review (2 of 4 in marketing/tier overhaul batch)
**Touches:** packages/db (1 migration), apps/api (1 route modified), apps/web (1 admin page + 2 customer pages modified, 1 component new)
**Scope:** medium — ~600 LOC

## Why

前台 `/` 首頁與 `/shop` 列表的商品順序目前 hardcode：
- `apps/web/src/lib/catalog.ts` query 預設按 `created_at DESC`（新品優先）
- 沒有「首頁精選版位」概念 — 首頁顯示什麼商品由前端硬編
- admin 無法控制商品在 /shop 列表的順序、無法把某商品 pin 到列表頂部
- 商品「冷門但要主推」(例如新代理品牌) admin 沒任何辦法手動拉抬

業務影響：每次新品上架或主推商品變動，得改前端 code 重新 deploy。

## Locked decisions
- 加 2 個欄位：`is_featured BOOLEAN` (首頁版位開關) + `display_priority INT` (列表排序權重，DESC，預設 0)
- 首頁版位最多顯示 8 個 featured 商品（多了用 display_priority 排序選前 8）
- /shop 列表排序：`is_featured DESC, display_priority DESC, created_at DESC`（精選永遠在前）

## Scope

### IN
1. Migration 0020 — `products` 加 `is_featured` + `display_priority`
2. `apps/api/src/routes/products.ts` — 列表 query 加新排序 + 接受 `featured_only=true` filter
3. `apps/web/src/app/admin/products/page.tsx` — list 加「⭐ 精選」toggle 欄 + drag handle 拖曳排序
4. 新 `apps/web/src/components/admin/DraggableProductList.tsx` — react-dnd or @dnd-kit 拖曳邏輯
5. `apps/web/src/app/page.tsx` (首頁) — 新「精選商品」section 用 `featured_only=true` query
6. `apps/web/src/app/shop/page.tsx` — 移除 `created_at` 排序，改 API 預設
7. `apps/web/src/lib/catalog.ts` — Product type 加 `is_featured` + `display_priority`

### OUT
- 每個分類各自 featured slots（首頁精選只一個全站 list）
- A/B testing 不同排序
- 排序 analytics
- 商品分組「組合商品」推薦
- 商品「即將下架」倒數標籤

## Design

### Section 1 — Migration 0020

`packages/db/migrations/0020_product_display_control.sql`:
```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_priority INT NOT NULL DEFAULT 0;

-- Composite index 列表 query 用
CREATE INDEX IF NOT EXISTS idx_products_display
  ON products(is_active, is_featured DESC, display_priority DESC, created_at DESC);
```

不做 backfill — 既有商品 `is_featured=false`, `display_priority=0`，照原 created_at 順序顯示。

### Section 2 — Backend (`apps/api/src/routes/products.ts`)

GET /products 加：
1. 排序改 `is_featured DESC, display_priority DESC, created_at DESC`
2. 新 query param `?featured_only=true` → 加 `.eq("is_featured", true)`
3. 新 endpoint `PATCH /admin/products/:id/feature` body `{ is_featured: boolean, display_priority?: int }` requireEditor
4. 新 endpoint `POST /admin/products/reorder` body `{ items: [{ id, display_priority }] }` requireEditor —— 拖曳 batch update

zod schema：
- `is_featured`: boolean
- `display_priority`: int min 0 max 99999

### Section 3 — Admin UI

`apps/web/src/app/admin/products/page.tsx` 改動：
- 表格新增「⭐」column (放在「上下架」旁邊)：每 row 一個 ⭐ icon button (空心 / 實心)，click toggle is_featured → PATCH
- 表格 row 左側加 drag handle (≡)，整 row 可拖
- 排序變化時 batch POST /admin/products/reorder 帶 reordered items 的新 display_priority (從上而下 = 99, 98, 97...)

新 `DraggableProductList.tsx` 用 `@dnd-kit/core` + `@dnd-kit/sortable`（既有 codebase 可能已用；grep 確認）。若沒裝，fallback 簡單 `<input type="number">` 直接編 display_priority 數字（簡單版 v1）。

實作 fallback 優先：v1 用 number input，省裝 lib + 開發時間。

### Section 4 — 首頁精選 section

`apps/web/src/app/page.tsx` 新 section（位置：banner 下方、4 方圖上方 OR 4 方圖下方，依現有 layout 決定）：

```tsx
const featured = await fetch(`${API_URL}/products?featured_only=true&limit=8`).then(r => r.json())
{featured.data.length > 0 && (
  <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
    <h2 className="text-2xl font-semibold text-[#10305a] mb-6">精選商品</h2>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {featured.data.map(p => <ProductCard key={p.id} product={p} />)}
    </div>
  </section>
)}
```

`ProductCard` 應已存在 (`/shop` 列表用同款)；複用。

如果 `featured.data` 為空 → 整 section 隱藏（不顯示空白標題）。

### Section 5 — /shop 列表排序統一

`apps/web/src/app/shop/page.tsx` — 若有 client-side `.sort((a,b)=> ...)` 移除，純由 API 排序。

`apps/web/src/lib/catalog.ts` Product type 加：
```ts
is_featured: boolean
display_priority: number
```

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0020_product_display_control.sql` |
| 改 | `apps/api/src/routes/products.ts` (排序 + 2 admin endpoints) |
| 改 | `apps/web/src/app/admin/products/page.tsx` (⭐ toggle + 排序 input) |
| 新 (optional) | `apps/web/src/components/admin/DraggableProductList.tsx` (v2 才寫) |
| 改 | `apps/web/src/app/page.tsx` (精選 section) |
| 改 | `apps/web/src/app/shop/page.tsx` (移除 client sort) |
| 改 | `apps/web/src/lib/catalog.ts` (type 加 2 欄) |

預估 ~400 LOC 新增 / ~200 LOC 修改 / 1 migration

## Validation

1. `npm run build` / `next build` 雙綠
2. Migration 0020 套用，verify 2 columns + 1 index 存在
3. admin 進 /admin/products 點某商品 ⭐ → DB `is_featured=true`，刷新首頁出現該商品
4. 改 display_priority=99 某商品 → /shop 列表變第一個
5. 設 4 個 featured → 首頁該 section 顯示 4 個；設 12 個 → 顯示 8 個（按 priority + created_at 取前 8）
6. featured=false 仍出現在 /shop（不影響 listing）

## Known caveats

- v1 用 number input 改 priority 不夠直覺，但夠用；若 admin 喊不夠人性化再上 @dnd-kit drag。
- `display_priority` 用 INT，admin 可能會卡「我要插在 5 和 6 之間」的問題。建議用 100 步進 (100, 200, 300...) 留空間；spec UI 顯示但不強制。
- 首頁 8 上限沒在 DB 強制 — 由前端 query `limit=8` 決定，admin 標 9 個 featured 第 9 個顯示在 /shop 頂部但不上首頁。
- 既有商品 0 featured 0 priority → 首頁 section 一開始空白；admin 須先進去點⭐才會有東西。
