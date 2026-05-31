ALTER TABLE products ADD COLUMN IF NOT EXISTS is_addon boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_products_is_addon ON products(is_addon) WHERE is_addon = true;
