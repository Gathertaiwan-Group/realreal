-- 0050: 商品自由文字 badge（例如「期間限定預購中，8/22起出貨」）
--
-- 目前商品卡片/商品頁上的標籤（優惠、OO限定）都是由既有欄位（sale_price、
-- min_tier_id）推導出來的，沒有一個可以自由填文字的欄位。這裡加一個
-- nullable 的 badge_text，NULL 時完全不顯示，不影響任何既有商品。

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS badge_text TEXT;

COMMENT ON COLUMN products.badge_text IS
  '商品卡片與商品頁上顯示的自由文字標籤（例如"期間限定預購中，8/22起出貨"）。
   NULL 時不顯示任何標籤，不影響既有的優惠/會員限定徽章邏輯。';
