-- Migration 0021: Tier validity + free-text perks + requalification rules
--
-- Spec: docs/superpowers/specs/2026-05-30-C-tier-overhaul-design.md (Section 1)
--
-- Purpose:
--   The 5-checkbox `benefits` array on membership_tiers has always been dead UI —
--   no code path in the repo actually applies them as discounts or shipping
--   modifiers. Meanwhile business reality (screenshot 3) requires:
--     - per-tier validity window (e.g. 知心 = 12 months, 同心 = 24 months)
--     - requalification rule ("must spend NT$3,500 within 6 months to renew")
--     - free-text perks the admin can edit ("常態 95 折", "公益存款 2.3%", ...)
--   None of these existed in schema, so tiers were permanent and admin perks
--   editing was decorative.
--
-- This migration:
--   1. Adds tagline / perks / validity_months / requalify_amount /
--      requalify_window_months to membership_tiers (all nullable-safe defaults
--      so the upgrade is non-breaking).
--   2. Adds tier_started_at / tier_expires_at / tier_period_spend to
--      user_profiles for the new daily tier-expire worker (Section 3) to
--      consume.
--   3. Backfills the 3 named tiers (初心之友 / 知心之友 / 同心之友) with the
--      tagline + perks + validity numbers from spec Section 1.
--   4. Backfills tier_started_at for existing tiered users (using created_at
--      as best-available proxy). tier_expires_at is left NULL — the daily
--      cron's first run will populate based on the tier's validity_months.

-- 1. membership_tiers: free-text perks + validity + requalification
ALTER TABLE membership_tiers
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS perks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS validity_months INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requalify_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requalify_window_months INT NOT NULL DEFAULT 6;

-- 2. user_profiles: per-user tier validity tracking
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS tier_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_period_spend NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 3. Backfill 3 named tiers per spec Section 1
UPDATE membership_tiers
  SET validity_months = 0,
      requalify_amount = 0,
      perks = '["常態 95 折", "消費金額 2.3% 累積為公益存款", "生日禮券，生日當月消費公益存款雙倍累積"]'::jsonb,
      tagline = '起於一念善意，從心出發'
  WHERE name = '初心之友';

UPDATE membership_tiers
  SET validity_months = 12,
      requalify_amount = 3500,
      requalify_window_months = 6,
      perks = '["常態 95 折", "消費金額 3.3% 累積為公益存款", "生日當月消費 9 折，公益存款雙倍累積", "線上講座與課程邀請"]'::jsonb,
      tagline = '彼此理解，真誠相遇'
  WHERE name = '知心之友';

UPDATE membership_tiers
  SET validity_months = 24,
      requalify_amount = 12000,
      requalify_window_months = 12,
      perks = '["常態 9 折", "消費金額 3.3% 累積為公益存款", "生日當月消費公益存款雙倍累積", "專屬生日禮", "線上與實體活動邀請"]'::jsonb,
      tagline = '同行於善，美好成真'
  WHERE name = '同心之友';

-- 4. Backfill existing tiered users' tier_started_at.
-- tier_expires_at left NULL deliberately — daily cron's first run will populate
-- based on the tier's validity_months, so legacy users get a fair fresh window.
UPDATE user_profiles
  SET tier_started_at = COALESCE(created_at, NOW())
  WHERE membership_tier_id IS NOT NULL
    AND tier_started_at IS NULL;
