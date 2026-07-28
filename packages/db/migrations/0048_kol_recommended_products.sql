-- 0048: Add kols.recommended_product_ids for per-KOL recommended products.
--
-- Background: /k/[slug] 的「推薦商品」區塊原本抓全站 is_featured=true 商品
-- （寫死 limit=8），不管哪個 KOL 頁面看到的都是同一份清單。這個欄位讓每個
-- KOL 可以有自己專屬、可排序的推薦商品清單。
--
-- 陣列順序 = 顯示順序，不另外開 sort_order 欄位。不加 FK constraint
-- （Postgres 陣列型別不支援），改由 API 寫入前驗證每個 ID 都存在且未下架。
--
-- Spec: docs/superpowers/specs/2026-07-28-kol-recommended-products-design.md

ALTER TABLE kols
  ADD COLUMN IF NOT EXISTS recommended_product_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN kols.recommended_product_ids IS
  '此 KOL 專屬推薦商品的 product id 陣列，陣列順序即前台顯示順序。由 apps/api/src/routes/admin-kols.ts 寫入前過濾成只保留存在且 is_active=true 的商品。';
