-- 0017_points_ledger_and_tier_rebate.sql
-- Points lifecycle ledger + lift rebate_rate from membership_tiers.benefits JSON to a top-level column.
-- See: docs/superpowers/specs/2026-05-30-points-tiers-customer-detail-design.md (Section 1).

-- 1. points_ledger table
CREATE TABLE IF NOT EXISTS points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta INT NOT NULL,                         -- positive = credit, negative = debit
  source TEXT NOT NULL CHECK (source IN (
    'earn',           -- order spend rebate (per tier.rebate_rate)
    'redeem',         -- checkout deduction
    'expire',         -- expiration offset (negative)
    'refund',         -- order cancel: revert earn / return redeem
    'manual_adjust',  -- admin manual +/- (note required)
    'promo'           -- reserved (birthday bonus / promo grants)
  )),
  source_ref_id TEXT,                         -- order_id / refund_id / promo_id / null
  note TEXT,                                  -- required for manual_adjust
  expires_at TIMESTAMPTZ,                     -- only meaningful for source='earn'; NULL otherwise
  actor_id UUID,                              -- admin user_id when manual_adjust
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_points_ledger_user
  ON points_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_points_ledger_expires
  ON points_ledger(expires_at)
  WHERE source = 'earn' AND expires_at IS NOT NULL;

-- 3. orders.points_used
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS points_used INT NOT NULL DEFAULT 0;

-- 4. membership_tiers.rebate_rate (top-level column)
ALTER TABLE membership_tiers
  ADD COLUMN IF NOT EXISTS rebate_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

-- 5. Backfill rebate_rate from existing benefits->>'rebate_rate' JSON value
UPDATE membership_tiers
SET rebate_rate = COALESCE((benefits->>'rebate_rate')::numeric, 0)
WHERE benefits ? 'rebate_rate';

-- 6. Strip rebate_rate key from benefits JSON (keep the rest of the checkbox perks)
UPDATE membership_tiers
SET benefits = benefits - 'rebate_rate'
WHERE benefits ? 'rebate_rate';

-- 7. Aggregated balance view (for list joins / admin dashboards)
CREATE OR REPLACE VIEW v_user_points_balance AS
SELECT user_id, COALESCE(SUM(delta), 0)::INT AS balance
FROM points_ledger
GROUP BY user_id;
