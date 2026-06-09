-- 0032: Idempotency safeguards for points_ledger + post-payment side effects
--
-- Audit (2026-06-09) found that grantPoints/redeemPoints/incrementSpendAndUpgrade
-- can all run twice for the same order via:
--   (a) PChomePay webhook sending both order_confirm + order_paid notifications
--   (b) Admin clicking POST /admin/orders/:id/retry-post-payment
--   (c) Gateway IPN retry until 2xx (LINE Pay / JKO Pay)
--   (d) Manual scripts/backfill-post-payment.ts
-- → Double earn / double redeem / double tier upgrade.
--
-- This migration enforces idempotency at the DB layer (unique partial indexes
-- where source IN ('earn','redeem')) and adds an order_post_payment_log table
-- to track tier/period_spend side effects that aren't naturally ledger-shaped.
-- Refund rows are NOT covered by unique indexes because refundOrderPoints
-- intentionally writes 2 rows per order (earn revert + redeem return); its
-- idempotency is guarded in code instead.

-- 1. Unique earn row per order (claim: every order grants at most 1 earn ledger row)
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ledger_earn_per_order
  ON points_ledger(source_ref_id)
  WHERE source = 'earn' AND source_ref_id IS NOT NULL;

-- 2. Unique redeem row per order (claim: every order burns at most 1 redeem ledger row)
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ledger_redeem_per_order
  ON points_ledger(source_ref_id)
  WHERE source = 'redeem' AND source_ref_id IS NOT NULL;

-- 3. Tracker for non-ledger post-payment side effects (tier upgrade, period spend)
CREATE TABLE IF NOT EXISTS order_post_payment_log (
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  tier_incremented_at TIMESTAMPTZ,
  period_spend_incremented_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE order_post_payment_log IS
  '記錄哪些訂單已觸發 tier upgrade / period spend 更新，避免 webhook 重送或 admin retry 重複加總';
