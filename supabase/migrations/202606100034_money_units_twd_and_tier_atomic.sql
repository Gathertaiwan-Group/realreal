-- 0034: Store order money as real TWD values and add atomic tier spend helpers.
--
-- Before this migration, orders.subtotal / shipping_fee / discount_amount /
-- total and order_items.unit_price were NUMERIC(10,2) columns but most writers
-- stored cents. This made every reader remember to divide by 100. From this
-- migration forward these columns store TWD dollars directly.

CREATE TABLE IF NOT EXISTS schema_migration_markers (
  key TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_migration_markers
    WHERE key = '0034_money_units_twd'
  ) THEN
    UPDATE orders
    SET
      subtotal = ROUND(subtotal / 100.0, 2),
      shipping_fee = ROUND(shipping_fee / 100.0, 2),
      discount_amount = ROUND(discount_amount / 100.0, 2),
      total = ROUND(total / 100.0, 2),
      campaign_discount = ROUND(COALESCE(campaign_discount, 0), 2);

    UPDATE order_items
    SET
      unit_price = ROUND(unit_price / 100.0, 2),
      product_snapshot =
        CASE
          WHEN product_snapshot ? 'unit_price'
            AND jsonb_typeof(product_snapshot->'unit_price') = 'number'
          THEN jsonb_set(
            product_snapshot,
            '{unit_price}',
            to_jsonb(ROUND(((product_snapshot->>'unit_price')::numeric / 100.0), 2))
          )
          ELSE product_snapshot
        END;

    INSERT INTO schema_migration_markers (key)
    VALUES ('0034_money_units_twd');
  END IF;
END $$;

COMMENT ON COLUMN orders.subtotal IS 'TWD dollars, not cents. Migrated in 0034.';
COMMENT ON COLUMN orders.shipping_fee IS 'TWD dollars, not cents. Migrated in 0034.';
COMMENT ON COLUMN orders.discount_amount IS 'TWD dollars, not cents. Migrated in 0034.';
COMMENT ON COLUMN orders.total IS 'TWD dollars, not cents. Migrated in 0034.';
COMMENT ON COLUMN order_items.unit_price IS 'TWD dollars, not cents. Migrated in 0034.';

CREATE OR REPLACE FUNCTION claim_order_post_payment_step(
  p_order_id UUID,
  p_step TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  claimed BOOLEAN := FALSE;
BEGIN
  INSERT INTO order_post_payment_log (order_id)
  VALUES (p_order_id)
  ON CONFLICT (order_id) DO NOTHING;

  IF p_step = 'tier_incremented' THEN
    UPDATE order_post_payment_log
    SET tier_incremented_at = now()
    WHERE order_id = p_order_id
      AND tier_incremented_at IS NULL
    RETURNING TRUE INTO claimed;
  ELSIF p_step = 'period_spend_incremented' THEN
    UPDATE order_post_payment_log
    SET period_spend_incremented_at = now()
    WHERE order_id = p_order_id
      AND period_spend_incremented_at IS NULL
    RETURNING TRUE INTO claimed;
  ELSIF p_step = 'spend_decremented' THEN
    UPDATE order_post_payment_log
    SET spend_decremented_at = now()
    WHERE order_id = p_order_id
      AND spend_decremented_at IS NULL
    RETURNING TRUE INTO claimed;
  ELSE
    RAISE EXCEPTION 'unknown post-payment step: %', p_step;
  END IF;

  RETURN COALESCE(claimed, FALSE);
END;
$$;

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
    v_charity_increment := ROUND(p_amount * (v_rebate / 100.0), 2);
    -- RHS must be table-qualified: charity_savings is also a RETURNS TABLE
    -- column, and plpgsql treats those as variables → 42702 ambiguous.
    UPDATE user_profiles
    SET charity_savings = COALESCE(user_profiles.charity_savings, 0) + v_charity_increment
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
    v_charity_decrement := ROUND(p_amount * (v_rebate / 100.0), 2);
  END IF;

  -- RHS table-qualified: these three are also RETURNS TABLE columns (42702).
  UPDATE user_profiles
  SET total_spend = GREATEST(0, COALESCE(user_profiles.total_spend, 0) - p_amount),
      tier_period_spend = GREATEST(0, COALESCE(user_profiles.tier_period_spend, 0) - p_amount),
      charity_savings = GREATEST(0, COALESCE(user_profiles.charity_savings, 0) - v_charity_decrement)
  WHERE user_id = p_user_id
  RETURNING * INTO v_profile;

  total_spend := v_profile.total_spend;
  tier_period_spend := v_profile.tier_period_spend;
  charity_savings := COALESCE(v_profile.charity_savings, 0);
  RETURN NEXT;
END;
$$;
