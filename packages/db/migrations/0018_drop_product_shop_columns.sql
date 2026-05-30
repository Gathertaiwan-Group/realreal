-- ============================================================================
-- Migration 0018: Drop product shop_left/middle/right columns
-- ============================================================================
--
-- Context:
--   The per-product shop_left, shop_middle, shop_right image columns are being
--   replaced by 9 shared shop info images served from static assets at
--   /product-info/6.jpg through /product-info/14.jpg. These shared images are
--   identical across the catalog, so storing per-row URLs was redundant.
--
-- Data loss notice:
--   This migration permanently deletes shop image data for 26 of 31 products.
--   The user explicitly approved this destructive change on 2026-05-30 after
--   reviewing the cleanup design spec
--   (docs/superpowers/specs/2026-05-30-product-editor-cleanup-design.md).
--   No backup of the dropped column values is being retained.
--
-- ============================================================================

ALTER TABLE products
  DROP COLUMN IF EXISTS shop_left,
  DROP COLUMN IF EXISTS shop_middle,
  DROP COLUMN IF EXISTS shop_right;
