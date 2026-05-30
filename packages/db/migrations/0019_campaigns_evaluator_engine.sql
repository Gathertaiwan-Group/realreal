-- Migration 0019: Campaigns evaluator engine — wire the campaigns table into checkout
--
-- Purpose:
--   The `campaigns` table + admin UI + 11 templates have existed since migrations
--   0006/0011, but the checkout flow in apps/api/src/routes/orders.ts never read
--   the table — making every "進行中" campaign decorative. This migration prepares
--   the schema for the new evaluator engine that finally runs campaigns at
--   checkout / grantPoints / tier-upgrade time.
--
-- This migration performs 4 operations:
--   1. Extend the campaigns_type_check CHECK constraint with a new
--      `birthday_bonus` type so dead "生日當月" campaigns get a real evaluator.
--   2. Convert existing birthday campaigns (config->>'promo_type'='birthday')
--      to the new `birthday_bonus` type, dropping the legacy `promo_type` key
--      and injecting `birthday_window_days: 31` for the evaluator.
--   3. Hard-delete 3 redundant tier-discount campaigns (初心/知心/同心 常態 N 折)
--      — the membership_tiers.discount_rate system already delivers that %.
--   4. Add 3 new columns to `orders` to persist evaluator output:
--      campaign_discount (NT$ off), applied_campaign_ids (UUID[]), free_items (JSONB).
--
-- Spec: docs/superpowers/specs/2026-05-30-campaigns-evaluator-engine-design.md
--       (Section 1 — Migration 0019)

-- 1. New type 'birthday_bonus'
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_type_check CHECK (
  type IN (
    'discount','freebie','points_multiplier','free_shipping',
    'bundle','buy_x_get_y','second_half_price','spend_threshold',
    'tier_upgrade_bonus','combo_discount','birthday_bonus'
  )
);

-- 2. Convert birthday campaigns to new type
UPDATE campaigns
SET type = 'birthday_bonus',
    config = config - 'promo_type' || '{"birthday_window_days": 31}'::jsonb
WHERE config->>'promo_type' = 'birthday';

-- 3. Delete redundant tier-discount campaigns (tier discount system delivers)
DELETE FROM campaigns
WHERE name IN (
  '初心之友常態95折',
  '知心之友常態95折',
  '同心之友常態9折'
);

-- 4. orders new columns for evaluator output
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS campaign_discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_campaign_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS free_items JSONB NOT NULL DEFAULT '[]'::jsonb;
