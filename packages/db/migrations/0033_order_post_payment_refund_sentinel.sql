-- 0033: Add refund-side sentinel to order_post_payment_log
--
-- Round-2 audit (2026-06-09) confirmed that refunding a paid order DOES NOT
-- decrement user_profiles.total_spend / tier_period_spend / charity_savings.
-- A user can wash-trade their way to 鑽石會員: pay NT$30k → tier upgraded →
-- request refund → keep tier → repeat. tier-expire worker also reuses the
-- refunded amount toward requalify_amount comparisons.
--
-- Fix: add a `spend_decremented_at` column matching the existing
-- `tier_incremented_at` / `period_spend_incremented_at` sentinels so a
-- decrement is idempotent across PATCH /:id/status + POST /:id/cancel +
-- bulk-status retries.

ALTER TABLE order_post_payment_log
  ADD COLUMN IF NOT EXISTS spend_decremented_at TIMESTAMPTZ;

COMMENT ON COLUMN order_post_payment_log.spend_decremented_at IS
  '何時把這筆訂單的 TWD amount 從 user_profiles.total_spend / tier_period_spend / charity_savings 扣回去（refund/cancel 時觸發），null = 未扣';
