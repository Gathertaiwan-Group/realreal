-- Soft-delete (封存) support for products and orders.
--
-- deleted_at IS NULL  = active (shown in admin + storefront)
-- deleted_at NOT NULL = archived: hidden from all listing queries, fully
--                       reversible by setting deleted_at back to NULL.
--
-- "封存" is the default delete action. A guarded *hard* delete (real row
-- removal) is only allowed by the API for provably-safe data:
--   • products whose variants were never ordered / used in a subscription plan
--   • orders that were never paid and have no issued invoice
-- so this column never has to protect financial/legal records on its own.

ALTER TABLE products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes keep the common "not archived" listing queries fast.
CREATE INDEX IF NOT EXISTS idx_products_not_deleted
  ON products(created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_not_deleted
  ON orders(created_at DESC) WHERE deleted_at IS NULL;
