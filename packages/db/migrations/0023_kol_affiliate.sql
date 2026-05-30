-- Migration 0023 — KOL / Affiliate marketing
-- Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md
-- Section 1: kols table + orders.attributed_kol_id + kol_clicks analytics

CREATE TABLE IF NOT EXISTS kols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  instagram_handle TEXT,
  youtube_handle TEXT,
  tiktok_handle TEXT,
  coupon_id UUID REFERENCES coupons(id),
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10,  -- e.g. 10 = 10%
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,                                         -- admin 內部備註
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kols_slug ON kols(slug);
CREATE INDEX IF NOT EXISTS idx_kols_active ON kols(is_active);

-- attribution on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS attributed_kol_id UUID REFERENCES kols(id),
  ADD COLUMN IF NOT EXISTS attributed_kol_slug TEXT;   -- 冗餘：避免 KOL 刪除後 audit 斷裂

CREATE INDEX IF NOT EXISTS idx_orders_kol ON orders(attributed_kol_id);

-- click tracking for analytics
CREATE TABLE IF NOT EXISTS kol_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kol_id UUID NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),  -- NULL for guests
  ip_hash TEXT,                            -- hash of IP (privacy)
  user_agent TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kol_clicks_kol ON kol_clicks(kol_id, clicked_at DESC);
