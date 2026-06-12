-- =====================================================================
-- 0037  Marketing-module integrity fixes (audit wave B).
-- Adds the atomic primitives the API code needs for B1/B2/B3/B8.
-- Safe to apply before the code ships (only adds functions + a column).
-- =====================================================================

-- ── B8: link a KOL to a user account, to exclude self-referred commission ──
ALTER TABLE kols ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_kols_user_id ON kols(user_id) WHERE user_id IS NOT NULL;

-- ── B3: atomic coupon-usage decrement (refund / cancel rollback) ──────────
-- Mirrors atomic_increment_coupon_usage (0028). Floors at 0 so a buggy double
-- call can never produce a negative used_count.
CREATE OR REPLACE FUNCTION atomic_decrement_coupon_usage(p_coupon_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE v_affected int;
BEGIN
  UPDATE coupons
     SET used_count = GREATEST(0, used_count - 1)
   WHERE id = p_coupon_id;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected > 0;
END;
$$;

-- ── B2: atomic claim + decrement of tier spend on refund ──────────────────
-- The old code decremented THEN claimed, so two concurrent cancels both passed
-- the early-out read and both decremented (double-decrement). This does the
-- claim and the decrement in ONE function = one transaction: the
-- order_post_payment_log row serialises concurrent callers (only the first
-- UPDATE ... WHERE spend_decremented_at IS NULL wins), and if the decrement
-- raises, the whole tx rolls back leaving the step UNclaimed for a safe retry.
-- Reuses the existing decrement_user_tier_spend() for the actual math.
CREATE OR REPLACE FUNCTION claim_and_decrement_tier_spend(
  p_order_id UUID,
  p_user_id  UUID,
  p_amount   NUMERIC
)
RETURNS TABLE (
  claimed           BOOLEAN,
  total_spend       NUMERIC,
  tier_period_spend NUMERIC,
  charity_savings   NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INT;
BEGIN
  INSERT INTO order_post_payment_log (order_id)
  VALUES (p_order_id)
  ON CONFLICT (order_id) DO NOTHING;

  UPDATE order_post_payment_log
     SET spend_decremented_at = now()
   WHERE order_id = p_order_id
     AND spend_decremented_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    -- Already decremented by an earlier/concurrent cancel → no-op, report state.
    RETURN QUERY
      SELECT FALSE, up.total_spend, up.tier_period_spend, up.charity_savings
        FROM user_profiles up WHERE up.user_id = p_user_id;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT TRUE, d.total_spend, d.tier_period_spend, d.charity_savings
      FROM decrement_user_tier_spend(p_user_id, p_amount) d;
END;
$$;

-- ── B1: guard against two concurrent orders each redeeming the full balance ─
-- Call AFTER inserting the order (which carries points_used). Serialises per
-- user via an advisory lock, then sums the points-redeem INTENT of all the
-- user's still-live orders created up to and including this one that don't yet
-- have a redeem ledger row, and returns FALSE if that cumulative intent exceeds
-- the current ledger balance. The first (older) of two racing orders passes;
-- the later one sees the combined intent exceed the balance and fails, so the
-- caller rolls it back. Keeps the existing redeem-at-payment lifecycle.
CREATE OR REPLACE FUNCTION check_points_not_oversubscribed(
  p_user_id  UUID,
  p_order_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance NUMERIC;
  v_intent  NUMERIC;
  v_created TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  SELECT created_at INTO v_created FROM orders WHERE id = p_order_id;
  IF v_created IS NULL THEN
    RETURN TRUE;  -- order vanished; nothing to guard
  END IF;

  SELECT COALESCE(SUM(delta), 0) INTO v_balance
    FROM points_ledger WHERE user_id = p_user_id;

  SELECT COALESCE(SUM(COALESCE(o.points_used, 0)), 0) INTO v_intent
    FROM orders o
   WHERE o.user_id = p_user_id
     AND o.status IN ('pending', 'processing', 'shipped', 'completed')
     AND o.payment_status IN ('pending', 'paid')
     AND COALESCE(o.points_used, 0) > 0
     AND o.created_at <= v_created
     AND NOT EXISTS (
       SELECT 1 FROM points_ledger pl
        WHERE pl.source = 'redeem' AND pl.source_ref_id = o.id
     );

  RETURN v_intent <= v_balance;
END;
$$;
