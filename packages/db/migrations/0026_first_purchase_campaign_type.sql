-- 0026: Extend campaigns_type_check to allow first_purchase
--
-- Spec O — first_purchase campaign type
-- (admin can now create active first_purchase campaigns; default NT$50 discount)

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_type_check;

ALTER TABLE campaigns ADD CONSTRAINT campaigns_type_check
  CHECK (type = ANY (ARRAY[
    'discount',
    'freebie',
    'points_multiplier',
    'free_shipping',
    'bundle',
    'buy_x_get_y',
    'second_half_price',
    'spend_threshold',
    'tier_upgrade_bonus',
    'combo_discount',
    'birthday_bonus',
    'first_purchase'
  ]::text[]));

-- Seed: insert one active first_purchase campaign with NT$50 / 0 threshold defaults
-- (Skipped in this migration — already inserted in production via Management API.
--  Re-running on a fresh DB requires manual seed or re-run this insert:)
-- INSERT INTO campaigns (name, description, type, config, is_active, starts_at)
-- VALUES ('首購折 NT$50', '新客首次下單折抵 50 元', 'first_purchase',
--         '{"discount_amount":50,"min_order_amount":0}'::jsonb, true, NOW());
