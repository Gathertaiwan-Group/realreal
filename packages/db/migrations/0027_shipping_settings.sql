-- 0027_shipping_settings.sql
-- Seed shipping fee config + public contact email into app_settings.
--
-- NOTE on schema mismatch vs original spec:
--   Original spec called for: INSERT INTO app_settings (key, value, description)
--   Actual schema (migration 0015) has columns: key, value_enc, updated_at, updated_by
--   There is no "description" column; values live in value_enc (AES ciphertext
--   per the runtime-settings design). These shipping fees and the public
--   contact email are NOT secrets, but to honour the table contract we still
--   write through value_enc. Descriptions are preserved here as SQL comments.

INSERT INTO app_settings (key, value_enc, updated_by) VALUES
  -- 宅配運費 NT$
  ('shipping.fee_home_delivery',  '100',              'migration:0027'),
  -- 超商取貨運費 NT$
  ('shipping.fee_cvs',            '60',               'migration:0027'),
  -- 宅配免運門檻 NT$ (0=永不免運)
  ('shipping.free_threshold_home','999',              'migration:0027'),
  -- 超商免運門檻 NT$
  ('shipping.free_threshold_cvs', '499',              'migration:0027'),
  -- 客服 email 公開顯示
  ('contact.email',               'love@realreal.cc', 'migration:0027')
ON CONFLICT (key) DO NOTHING;
