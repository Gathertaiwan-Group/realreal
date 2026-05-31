# Spec N — Admin nav 合併 + 商品分類 DB 清理 + /category/[slug] bug fix

**Date:** 2026-05-31
**Status:** Draft (user approved scope A)
**Touches:** apps/web (4 admin page + 1 admin layout + 1 storefront page), packages/db (1 migration)
**Scope:** small — ~200 LOC + 1 migration

## Why

3 個現實問題同時出現，根因互相牽連，1 個 spec 解決：

1. **後台 nav 太散** — 「商品」「分類」分兩個 entry、「文章」「文章分類」分兩個 entry，4 個 nav item 其實只代表 2 個業務領域。
2. **商品分類 DB 太亂** — production DB 有 **11 個 categories row**：
   - 4 個「凍乾水果」(slug `cat-cacaa34e` / `freeze-dried` / `cat-efead131` / `cat-cf520a57`，只有 `freeze-dried` 有 7 個商品，其他 3 個是 0)
   - 3 個「禮物」(slug 用中文 `禮物` / `禮物-禮物` / `禮物-禮物-2`，全 0 商品)
   - 1 個 `All` (WooCommerce legacy，5 個無分類商品被丟在這)
   - 3 個乾淨的：植物高蛋白粉 / 永續生活 / freeze-dried 凍乾水果
   後台一打開 11 個亂七八糟，前台 tab 也讀到全部。
3. **`/category/[slug]` 點任一 tab 都 404** — spec J 加的 landing page 把 `params` type 寫成 `{ category: string }` 但 Next.js dynamic segment 是 `[slug]`，解構出來永遠 undefined。

修完這 3 件事，「前後台連動」自然成立：admin 改 DB → 前台 `getCategories()` 立刻反映 → 點 tab 進 `/category/<slug>` 看商品 grid → work。

## Locked decisions

- Nav 合併走**既有 `AdminTabs` pattern** — 路徑不變、tab 在 page 頂端、避開 SPA-style 假 tab
- DB 清成 **4 個 canonical row**：植物高蛋白粉 / 凍乾水果 / 永續生活 / 禮物
- 商品歸屬：1 個商品 1 個分類（維持單 FK，不改多對多）
- 「All」row 的 **5 個無分類商品全部 reassign 到「植物高蛋白粉」**（最大那個分類）。reassign 錯的部分後台手動拉到對的分類
- 「禮物」殼**留著** (slug rename 中文→`gift`)，0 商品也保留，之後上禮盒商品時再 assign

## Scope

### IN
1. `apps/web/src/app/admin/layout.tsx` 移除 2 個 nav item (「分類」「文章分類」)
2. 4 個 admin page 頂端加 `<AdminTabs />` (商品/分類、文章/分類)
3. Migration 0025 — 清理 categories table
4. `apps/web/src/app/category/[slug]/page.tsx` 修 params bug
5. 驗證腳本（手動 SQL + storefront 點擊 smoke test）

### OUT
- 後台分類 detail drill-in（B 方案）— 未來再做
- 商品多分類關聯（C 方案）— 未來再做
- categories 表加 `is_active` / `display_order` 欄位 — 現有 schema 夠用
- 商品 reassign 後的「對不對」判斷 — user 手動處理
- KOL `recommended_products` / 行銷活動 `target_categories` 等下游 query 改動 — 不受影響（仍是單 category_id FK）

## Design

### Section 1 — Admin nav 合併

**檔案：`apps/web/src/app/admin/layout.tsx`**

`NAV_ITEMS` 從 10 個減到 8 個，移除：
```diff
- { href: "/admin/categories", label: "分類", icon: Folders, roles: ["admin", "editor"] },
- { href: "/admin/posts/categories", label: "文章分類", icon: FolderTree, roles: ["admin", "editor"] },
```

import 也順手清掉 `Folders`、`FolderTree` 兩個未用 icon。

**4 個 page.tsx 頂端加 AdminTabs：**

```tsx
// apps/web/src/app/admin/products/page.tsx + admin/categories/page.tsx
<AdminTabs tabs={[
  { href: "/admin/products", label: "商品" },
  { href: "/admin/categories", label: "分類" },
]} />

// apps/web/src/app/admin/posts/page.tsx + admin/posts/categories/page.tsx
<AdminTabs tabs={[
  { href: "/admin/posts", label: "文章" },
  { href: "/admin/posts/categories", label: "分類" },
]} />
```

`AdminTabs` 已存在 (`apps/web/src/app/admin/_components/AdminTabs.tsx`)，自動依 `usePathname()` 高亮 active tab。位置：放在現有 `<h1>` 之上、`<div className="space-y-6">` 開頭。

URL 路徑不變 → 既有書籤、deep link 全保留。

### Section 2 — DB categories 清理 migration

`packages/db/migrations/0025_categories_cleanup.sql`:

```sql
-- 0025: Dedupe categories table to 4 canonical rows + reassign orphans
--
-- Pre-state (production 2026-05-31):
--   11 rows, 4 dup "凍乾水果", 3 dup "禮物" (中文 slug), 1 legacy "All"
--   只有 freeze-dried (n=7), plant-based-powder (n=16), sustain-life (n=3), All (n=5) 有商品
--
-- Post-state:
--   4 rows: plant-based-powder (21), freeze-dried (7), sustain-life (3), gift (0)

BEGIN;

-- 1. 把 3 個重複的「凍乾水果」(cat-xxxx) 商品搬到 canonical freeze-dried
--    (這 3 個 row 目前 n=0，UPDATE 預期 0 rows changed，純 defensive)
UPDATE products SET category_id = '133ad6b1-ada9-4add-9d65-8bf99cf31355'
  WHERE category_id IN (
    '18f467f1-08be-4873-96b9-419035d25c42',
    'f000cbd4-24da-4dd6-96dc-72d931baaab4',
    'f267240a-3d59-44ef-b8cf-276d880fcb7d'
  );

-- 2. 「All」row 那 5 個無分類商品搬到「植物高蛋白粉」
UPDATE products SET category_id = '0c27248d-807f-43a0-9a25-a50fc2bea69a'
  WHERE category_id = '72d7314f-9bed-42e3-ad0b-3719fff40e4c';

-- 3. 「禮物」2 個 children 移到 parent (n=0，純 defensive)
UPDATE products SET category_id = 'c6489e2f-1a47-45fc-ac39-034b177ccd06'
  WHERE category_id IN (
    '364b3a46-1ec2-43ad-a044-f0cb982e1cfd',
    '4de98bf4-993a-4c12-98e2-314ae5920542'
  );

-- 4. DELETE 7 個垃圾 row
DELETE FROM categories WHERE id IN (
  '18f467f1-08be-4873-96b9-419035d25c42', -- 凍乾水果 dup
  'f000cbd4-24da-4dd6-96dc-72d931baaab4', -- 凍乾水果 dup
  'f267240a-3d59-44ef-b8cf-276d880fcb7d', -- 凍乾水果 dup
  '364b3a46-1ec2-43ad-a044-f0cb982e1cfd', -- 禮物 child
  '4de98bf4-993a-4c12-98e2-314ae5920542', -- 禮物 child
  '72d7314f-9bed-42e3-ad0b-3719fff40e4c'  -- All legacy
);

-- 5. 「禮物」parent rename slug 中文→英文 (避免 URL encoding 問題)
UPDATE categories SET slug = 'gift'
  WHERE id = 'c6489e2f-1a47-45fc-ac39-034b177ccd06';

-- 6. sort_order normalize (1..4)
UPDATE categories SET sort_order = 1 WHERE slug = 'plant-based-powder';
UPDATE categories SET sort_order = 2 WHERE slug = 'freeze-dried';
UPDATE categories SET sort_order = 3 WHERE slug = 'sustain-life';
UPDATE categories SET sort_order = 4 WHERE slug = 'gift';

COMMIT;

-- Verification (run after):
-- SELECT slug, name, sort_order, (SELECT COUNT(*) FROM products WHERE category_id = c.id) AS n
-- FROM categories c ORDER BY sort_order;
-- Expected: 4 rows, plant-based-powder n=21, freeze-dried n=7, sustain-life n=3, gift n=0
```

**Migration 套用方式**：透過 Supabase Management API SQL endpoint (與 0022-0024 同 pattern)，或 user 在 Supabase Dashboard SQL Editor 手動貼。

### Section 3 — `/category/[slug]` params bug fix

`apps/web/src/app/category/[slug]/page.tsx`:

```diff
 export default async function CategoryLandingPage({
   params,
 }: {
-  params: Promise<{ category: string }>
+  params: Promise<{ slug: string }>
 }) {
-  const { category: slug } = await params
+  const { slug } = await params
```

3 行改動。Next.js dynamic segment `[slug]` 的 params key 必須叫 `slug`。

順手檢查：`generateMetadata`、`generateStaticParams` 等其他 export 也用同樣 type（若有）。

### Section 4 — 驗證

**DB 驗證（migration 跑完後）**：
```sql
SELECT slug, name, sort_order,
       (SELECT COUNT(*) FROM products WHERE category_id = c.id) AS n
FROM categories c ORDER BY sort_order;
-- 預期 4 row：plant-based-powder(21) / freeze-dried(7) / sustain-life(3) / gift(0)
```

**前台 smoke test**：
1. 訪問 `https://realreal-store.vercel.app/shop` → 4 個 tab 顯示
2. 點「植物高蛋白粉」→ `/category/plant-based-powder` 顯示 21 個商品 grid
3. 點「凍乾水果」→ `/category/freeze-dried` 顯示 7 個
4. 點「永續生活」→ 3 個
5. 點「禮物」→ 0 個（顯示 empty state，不是 404）
6. 點「全部商品」回 `/shop`

**後台 smoke test**：
1. `/admin/products` → 頂端有「商品 ｜ 分類」tab、商品列表正常
2. 點分類 tab → `/admin/categories` 顯示 4 個 row
3. 點商品編輯 → 「商品分類」下拉只剩 4 個選項
4. `/admin/posts` → 頂端有「文章 ｜ 分類」tab
5. 左 sidebar nav 只剩 8 個 item（沒「分類」沒「文章分類」單獨出現）

**`tsc` 雙綠 + 既有 admin tests pass**。

## File summary

| 動作 | 路徑 | LOC |
|---|---|---|
| 改 | `apps/web/src/app/admin/layout.tsx` | -3 |
| 改 | `apps/web/src/app/admin/products/page.tsx` | +8 |
| 改 | `apps/web/src/app/admin/categories/page.tsx` | +8 |
| 改 | `apps/web/src/app/admin/posts/page.tsx` | +8 |
| 改 | `apps/web/src/app/admin/posts/categories/page.tsx` | +8 |
| 改 | `apps/web/src/app/category/[slug]/page.tsx` | ±3 |
| 新 | `packages/db/migrations/0025_categories_cleanup.sql` | +60 |
| 套 migration | production Supabase via Management API | — |

預估 ~100 LOC code + ~60 LOC SQL / 1 migration

## Risks

- **Reassigned 5 商品不對**：user 自己拉。可在 admin/categories 點「植物高蛋白粉 (21)」（需 drill-in，這 spec OUT）— 退而求其次，admin/products 列表 filter by category 已可用。
- **`category_id` FK 限制**：reassign 後若 `0c27248d` row 被誤刪會違反 FK；migration 第 2 步在第 4 步刪 row **之前**做，順序安全。
- **`禮物` slug 改名後既有 URL 失效**：`/category/禮物` 之類 URL 失效。production 沒任何流量指向中文 slug（DB 證據：n=0），可接受。

## ⚠️ User action

Migration 0025 我會幫你跑（用同樣 Supabase Management API），不用你手動貼。我 implementation 完會驗證後告知。
