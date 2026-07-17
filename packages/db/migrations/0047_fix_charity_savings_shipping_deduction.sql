-- Fix charity_savings formula: must deduct the NT$80 shipping baseline BEFORE
-- applying the tier rebate rate. Both increment_user_tier_spend (migration
-- 0034) and its refund-reversal counterpart decrement_user_tier_spend were
-- computing charity as `amount * rebate_rate`, omitting the -80 deduction the
-- business actually uses: (amount - 80) * rebate_rate. Clamped at 0 so a
-- sub-NT$80 order never yields negative/phantom charity.

CREATE OR REPLACE FUNCTION increment_user_tier_spend(
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS TABLE (
  total_spend NUMERIC,
  tier_period_spend NUMERIC,
  membership_tier_id UUID,
  charity_savings NUMERIC,
  tier_changed BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile user_profiles%ROWTYPE;
  v_new_total NUMERIC;
  v_new_period NUMERIC;
  v_eligible membership_tiers%ROWTYPE;
  v_existing_tier UUID;
  v_existing_min_spend NUMERIC := 0;
  v_validity_months INT;
  v_expires_at TIMESTAMPTZ;
  v_rebate NUMERIC := 0;
  v_charity_increment NUMERIC := 0;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_existing_tier := v_profile.membership_tier_id;
  IF v_existing_tier IS NOT NULL THEN
    SELECT COALESCE(min_spend, 0) INTO v_existing_min_spend
    FROM membership_tiers
    WHERE id = v_existing_tier;
  END IF;
  v_new_total := COALESCE(v_profile.total_spend, 0) + p_amount;
  v_new_period := COALESCE(v_profile.tier_period_spend, 0) + p_amount;

  SELECT * INTO v_eligible
  FROM membership_tiers
  WHERE v_new_period >= min_spend
  ORDER BY min_spend DESC
  LIMIT 1;

  IF v_eligible.id IS NULL THEN
    UPDATE user_profiles
    SET total_spend = v_new_total,
        tier_period_spend = v_new_period
    WHERE user_id = p_user_id
    RETURNING * INTO v_profile;
  ELSIF v_eligible.id IS DISTINCT FROM v_existing_tier
    AND COALESCE(v_eligible.min_spend, 0) > v_existing_min_spend THEN
    v_validity_months := COALESCE(v_eligible.validity_months, 0);
    v_expires_at :=
      CASE
        WHEN v_validity_months > 0 THEN now() + make_interval(months => v_validity_months)
        ELSE NULL
      END;

    UPDATE user_profiles
    SET membership_tier_id = v_eligible.id,
        total_spend = v_new_total,
        tier_started_at = now(),
        tier_expires_at = v_expires_at,
        tier_period_spend = 0
    WHERE user_id = p_user_id
    RETURNING * INTO v_profile;
  ELSE
    UPDATE user_profiles
    SET total_spend = v_new_total,
        tier_period_spend = v_new_period
    WHERE user_id = p_user_id
    RETURNING * INTO v_profile;
  END IF;

  SELECT COALESCE(rebate_rate, 0) INTO v_rebate
  FROM membership_tiers
  WHERE id = v_profile.membership_tier_id;

  IF v_rebate > 0 THEN
    -- NT$80 shipping baseline deducted before applying the rebate rate.
    v_charity_increment := ROUND(GREATEST(p_amount - 80, 0) * (v_rebate / 100.0), 2);
    UPDATE user_profiles
    SET charity_savings = COALESCE(charity_savings, 0) + v_charity_increment
    WHERE user_id = p_user_id
    RETURNING * INTO v_profile;
  END IF;

  total_spend := v_profile.total_spend;
  tier_period_spend := v_profile.tier_period_spend;
  membership_tier_id := v_profile.membership_tier_id;
  charity_savings := COALESCE(v_profile.charity_savings, 0);
  tier_changed := v_profile.membership_tier_id IS DISTINCT FROM v_existing_tier;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_user_tier_spend(
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS TABLE (
  total_spend NUMERIC,
  tier_period_spend NUMERIC,
  charity_savings NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_profile user_profiles%ROWTYPE;
  v_rebate NUMERIC := 0;
  v_charity_decrement NUMERIC := 0;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_profile.membership_tier_id IS NOT NULL THEN
    SELECT COALESCE(rebate_rate, 0) INTO v_rebate
    FROM membership_tiers
    WHERE id = v_profile.membership_tier_id;
  END IF;

  IF v_rebate > 0 THEN
    v_charity_decrement := ROUND(GREATEST(p_amount - 80, 0) * (v_rebate / 100.0), 2);
  END IF;

  UPDATE user_profiles
  SET total_spend = GREATEST(0, COALESCE(total_spend, 0) - p_amount),
      tier_period_spend = GREATEST(0, COALESCE(tier_period_spend, 0) - p_amount),
      charity_savings = GREATEST(0, COALESCE(charity_savings, 0) - v_charity_decrement)
  WHERE user_id = p_user_id
  RETURNING * INTO v_profile;

  total_spend := v_profile.total_spend;
  tier_period_spend := v_profile.tier_period_spend;
  charity_savings := COALESCE(v_profile.charity_savings, 0);
  RETURN NEXT;
END;
$$;
