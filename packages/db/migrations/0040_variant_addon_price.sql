-- 0040_variant_addon_price.sql
-- Add per-variant 加購價 (add-on price). A variant with non-null addon_price,
-- whose product has is_addon=true, may be sold at this price for the FIRST 1 unit
-- when the cart also contains a qualifying non-add-on item. Server-enforced in
-- apps/api/src/routes/orders.ts (POST / and POST /preview). NUMERIC(10,2) TWD,
-- mirrors product_variants.price. Nullable. Idempotent.
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS addon_price NUMERIC(10,2);
NOTIFY pgrst, 'reload schema';
