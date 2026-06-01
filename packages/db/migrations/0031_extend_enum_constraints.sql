-- Extend CHECK constraints to support new shipping/payment methods
-- overseas_cod: overseas delivery with COD (pay driver on arrival)
-- cvs_cod: CVS pickup with ECPay collection (pay at store)

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('pchomepay','linepay','jkopay','cvs_cod'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_shipping_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_shipping_method_check
  CHECK (shipping_method IN ('cvs_711','cvs_family','home_delivery','overseas_cod'));

ALTER TABLE order_addresses DROP CONSTRAINT IF EXISTS order_addresses_address_type_check;
ALTER TABLE order_addresses ADD CONSTRAINT order_addresses_address_type_check
  CHECK (address_type IN ('home','cvs','overseas'));
