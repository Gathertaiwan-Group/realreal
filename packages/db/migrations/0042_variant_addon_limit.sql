-- 0042_variant_addon_limit.sql
--
-- Per-variant 加購數量上限 (add-on quantity cap). The FIRST `addon_limit` units of
-- an add-on variant get the addon_price; remaining qty falls back to the normal
-- price (soft cap — the customer is never blocked). Server-enforced in
-- apps/api/src/lib/addon-pricing.ts (computeAddonPricing).
--
-- DEFAULT 1 preserves the previous hard-coded "first 1 unit only" behaviour for
-- every existing variant. Idempotent.

ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS addon_limit INT NOT NULL DEFAULT 1;

-- Reload PostgREST schema cache so the new column is selectable immediately.
NOTIFY pgrst, 'reload schema';
