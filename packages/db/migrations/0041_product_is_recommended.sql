-- 0041_product_is_recommended.sql
--
-- Add products.is_recommended — an admin toggle (like is_addon) that controls
-- whether a product appears in the cart drawer's「你也可能喜歡」strip. The strip
-- (apps/web/src/lib/cart-recommendations.ts) now prioritises is_recommended=true,
-- falling back to best-selling → any active product when none/not enough are
-- flagged. Distinct from is_featured (shop-page ordering).
--
-- Mirrors 0030_addon_flag.sql. Idempotent.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_products_is_recommended
  ON products(is_recommended) WHERE is_recommended = true;

-- Reload PostgREST schema cache so GET /products can select the new column
-- immediately (else the first request 500s with a "schema cache" error).
NOTIFY pgrst, 'reload schema';
