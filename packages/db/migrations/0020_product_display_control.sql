-- Migration 0020: Product display control — featured slots + sort priority
--
-- Spec: docs/superpowers/specs/2026-05-30-B-product-display-control-design.md (Section 1)
--
-- Purpose:
--   Front-end ordering on `/` and `/shop` is currently hardcoded to created_at DESC,
--   and there is no concept of a homepage "featured" slot. Admins cannot pin a
--   product to the top of the listing or surface a low-volume product on the
--   homepage without a code change + deploy.
--
--   This migration adds two columns to `products`:
--     - is_featured       BOOLEAN — homepage featured-slot toggle
--     - display_priority  INT     — listing sort weight (DESC, default 0)
--
--   Plus one composite index for the new listing sort:
--     ORDER BY is_active, is_featured DESC, display_priority DESC, created_at DESC
--
--   No backfill — existing rows default to is_featured=false, display_priority=0,
--   so the visible order stays identical to today (created_at DESC) until admins
--   start flipping the new toggles.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_priority INT NOT NULL DEFAULT 0;

-- Composite index for the listing query
CREATE INDEX IF NOT EXISTS idx_products_display
  ON products(is_active, is_featured DESC, display_priority DESC, created_at DESC);
