# Spec — KOL 專屬推薦商品

**Date:** 2026-07-28
**Status:** Draft → user approved (方案 A)
**Touches:** packages/db (1 migration), apps/api (2 route files), apps/web (1 admin component + 1 admin form + 1 public page + 1 public route param)
**Scope:** small — ~250-350 LOC

## Why

使用者正在後台設定 KOL「Claire」的專屬頁面（`/k/clairelien`），發現「推薦商品」區塊最多只顯示 8 樣商品。

追查後發現兩個問題：
1. `apps/web/src/app/k/[slug]/page.tsx` 的 `getFeaturedProducts()` 寫死 `limit=8`。
2. 更根本的問題：這個區塊**不是針對個別 KOL 的**——不管網址是哪個 KOL 的 slug，抓的都是全站 `is_featured=true` 的同一份商品清單。後台目前完全沒有「幫某個 KOL 選商品」的介面。

原始 KOL 規格文件（`2026-05-31-I-kol-affiliate-design.md`）第 159 行其實已經預留了這個方向：
> 「Recommended products section: 顯示 KOL 的 featured products (v1 簡單顯示 is_featured=true 商品；v2 可加 kols.recommended_product_ids[])」

這份 spec 就是實作上面提到的 v2。

## Locked decisions（與使用者 2026-07-28 確認）

1. **資料模型**：`kols` 表加一個 `recommended_product_ids uuid[]` 欄位（方案 A），不另開關聯表。陣列順序即顯示順序。
2. **清空時的行為**：某 KOL 的 `recommended_product_ids` 是空陣列時，該頁「推薦商品」整個區塊**不顯示**（不 fallback 回全站精選商品，也不顯示空清單標題）。
3. **排序方式**：後台需要手動排序，用 ▲▼ 上下箭頭（不做拖曳，功能等價、不用多裝套件）。
4. **數量上限**：不設上限。

## Scope

### IN
1. Migration 0048 — `kols.recommended_product_ids uuid[] NOT NULL DEFAULT '{}'`
2. `apps/api/src/routes/admin-kols.ts` — create/update schema 增加 `recommended_product_ids`，寫入前過濾成只保留存在且 `is_active=true` 的商品 ID
3. `apps/api/src/routes/kols.ts`（公開 `GET /kols/:slug`）— 依陣列順序查出對應商品，一併回傳
4. `apps/web/src/app/admin/kols/ProductPicker.tsx`（新元件，仿照現有 `CouponPicker.tsx` 的資料抓取模式）— 打勾清單（依分類分組）+ 已選商品排序區（▲▼ 按鈕）
5. `apps/web/src/app/admin/kols/[id]/_client.tsx` — 表單裡加入 `<ProductPicker />`，送出時一併帶 `recommended_product_ids`
6. `apps/web/src/app/admin/kols/[id]/actions.ts` — `KolUpsertInput` / `KolUpdateInput` 增加 `recommended_product_ids?: string[]`
7. `apps/web/src/app/k/[slug]/page.tsx` — 移除 `getFeaturedProducts()`（含寫死的 `limit=8`），改用 KOL API 回傳的 `products` 陣列
8. `apps/web/src/app/k/[slug]/_client.tsx` — 確認/調整「推薦商品」區塊在 `products` 為空陣列時完全不 render（目前已有空陣列判斷，需要核對是否符合「整個區塊隱藏」而非「顯示空清單」）

### OUT
- 關聯表（`kol_products`）版本的資料模型（方案 B，未來若需要每商品備註或報表再升級）
- 拖曳排序 UI（用上下箭頭達到一樣的效果）
- 商品數量上限
- 後台商品勾選清單的搜尋/篩選 UI（目前僅 27 樣上架商品，量不大，暫不需要）
- 「這個商品幫哪個 KOL 帶了多少單」報表（已有的「Top 5 帶單商品」是既有功能，非本次範圍）

## Design

### 1. Migration 0048

`packages/db/migrations/0048_kol_recommended_products.sql`:
```sql
ALTER TABLE kols
  ADD COLUMN IF NOT EXISTS recommended_product_ids UUID[] NOT NULL DEFAULT '{}';
```
不加陣列元素的 FK constraint（Postgres 陣列型別不支援），改在 API 寫入時做存在性 + 上架狀態過濾。

### 2. `apps/api/src/routes/admin-kols.ts`

`kolCreateSchema` / update schema 增加：
```ts
recommended_product_ids: z.array(z.string().uuid()).optional(),
```

寫入前（create 與 update 共用邏輯）：
```ts
if (parsed.data.recommended_product_ids) {
  const { data: validProducts } = await supabase
    .from("products")
    .select("id")
    .in("id", parsed.data.recommended_product_ids)
    .eq("is_active", true)
  const validIds = new Set((validProducts ?? []).map(p => p.id))
  // 保留原陣列順序，只濾掉不存在/已下架的 ID
  parsed.data.recommended_product_ids =
    parsed.data.recommended_product_ids.filter(id => validIds.has(id))
}
```
GET（list + detail）的 `select` 字串加上 `recommended_product_ids`，讓後台編輯頁能讀到目前已選的商品。

### 3. `apps/api/src/routes/kols.ts`（公開路由）

`GET /:slug` 的 select 增加 `recommended_product_ids`。查完 KOL 之後，若陣列非空，用一次額外查詢取商品資料：
```ts
const productIds = kol.recommended_product_ids ?? []
let products: ProductSummary[] = []
if (productIds.length > 0) {
  const { data } = await supabase
    .from("products")
    .select("id, name, slug, images, is_active, min_price, min_sale_price, category_id")
    .in("id", productIds)
    .eq("is_active", true)
  const byId = new Map((data ?? []).map(p => [p.id, p]))
  // 依 recommended_product_ids 的順序輸出，濾掉已下架/查無的
  products = productIds.map(id => byId.get(id)).filter(Boolean)
}
```
回傳結構在既有 `data` 物件下新增 `products` 欄位。

### 4. `apps/web/src/app/admin/kols/ProductPicker.tsx`（新檔）

參考 `CouponPicker.tsx` 的資料抓取模式（`adminFetch` + `useEffect` 取商品清單），但這次是多選 + 可排序：

- Props：`name`（用於 hidden input，供表單 FormData 讀取）、`defaultValue: string[]`
- 內部 state：`selected: string[]`（排序後的已選 ID 陣列）
- UI 分兩塊：
  - 上半：全部上架商品的打勾清單，依 `category_id` 分組顯示分類標題，每行商品縮圖 + 名稱 + checkbox
  - 下半：「已選商品」清單，依 `selected` 陣列順序顯示，每行有 ▲▼ 按鈕（呼叫時 swap 陣列相鄰元素）與一個移除按鈕
- 因為表單目前是受控 React 元件（`handleSubmit` 手動組 payload，而非原生 FormData 提交），`ProductPicker` 用一般的 `value`/`onChange` callback prop 模式（不是 `CouponPicker` 那種靠 `name` 走原生表單提交的模式）——需要先讀一次 `_client.tsx` 現有 `handleSubmit` 的組 payload方式，跟著用同樣的模式接進去，而不是照抄 `CouponPicker` 的 `<select name=...>` 寫法。

### 5. `apps/web/src/app/admin/kols/[id]/_client.tsx`

- import 新的 `ProductPicker`
- 表單 state 增加 `recommendedProductIds: string[]`，初始值來自 `kol.recommended_product_ids ?? []`
- render 區塊放在 `<CouponPicker />` 附近（同屬「行銷設定」分組）
- `handleSubmit` 組 payload 時帶上 `recommended_product_ids: recommendedProductIds`

### 6. `apps/web/src/app/admin/kols/[id]/actions.ts`

`KolUpsertInput` 與 `KolUpdateInput` 都加：
```ts
recommended_product_ids?: string[]
```

### 7. `apps/web/src/app/k/[slug]/page.tsx`

- 刪除 `getFeaturedProducts()` 函式與其呼叫
- `Kol` type 增加 `products: Product[]`
- `getKol()` 回傳的 `json.data` 已包含 `products`（來自後端），直接透傳給 `<KolLandingClient kol={kol} products={kol.products} />`（或視現有 props 結構調整，維持 `KolLandingClient` 介面不變最省事）

### 8. `apps/web/src/app/k/[slug]/_client.tsx`

核對現有「暫無推薦商品」的 render 邏輯（目前程式碼裡看到 `暫無推薦商品` 字樣）——需要改成：`products.length === 0` 時整個區塊（含標題）不 render，而不是顯示「暫無推薦商品」的空狀態文字。這是本次唯一需要修改既有行為（而非單純新增）的地方。

## 測試 / 驗收方式

沒有自動化測試框架涵蓋這幾支檔案（沿用 codebase 現況，多數 route 靠既有 `__tests__` 慣例；若 `admin-kols.ts`/`kols.ts` 已有測試檔，新增案例覆蓋：陣列過濾下架商品、空陣列、正常排序回傳）。手動驗收：
1. 後台勾選 Claire 3-5 樣商品、調整順序、儲存
2. 開 `/k/clairelien`，確認只顯示勾選的商品、順序正確
3. 開一個尚未設定的 KOL 頁面（如 `/k/armand`），確認「推薦商品」區塊整個不出現
4. 後台把 Claire 其中一樣商品下架，重新整理 `/k/clairelien`，確認該商品自動從列表消失（不報錯）
