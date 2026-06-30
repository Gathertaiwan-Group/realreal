-- 0045: Short 8-digit order numbers via PG sequence
--
-- Background: order_number was `RR<13-digit-timestamp><8-hex>` = 23 chars,
-- ugly to read out over phone / paste into support tickets. User wants 8
-- digits total — short, memorable, no prefix.
--
-- Design:
--   - Sequence `order_number_seq` issues monotonic integers.
--   - RPC `next_order_number()` returns the next value zero-padded to 8
--     chars (so "10000001", "10000002", ...).
--   - Start at 10,000,001 so the very first number is already 8 digits
--     (no leading zeros) AND looks like the shop already has volume —
--     a mild trust signal. 99,999,999 ceiling gives ~89 million orders
--     of headroom; we'll never hit it.
--
-- Existing order_numbers (WP1234… / RR<ts><hex>…) are NOT migrated. The
-- column is TEXT UNIQUE, so old and new formats co-exist. New checkouts
-- after this migration use the sequence.

CREATE SEQUENCE IF NOT EXISTS order_number_seq
  MINVALUE 1
  MAXVALUE 99999999
  START WITH 10000001
  CACHE 1
  NO CYCLE;

CREATE OR REPLACE FUNCTION next_order_number() RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v BIGINT;
BEGIN
  v := nextval('order_number_seq');
  RETURN LPAD(v::text, 8, '0');
END;
$$;

-- service_role can already execute anything; the GRANT below lets the
-- function be reachable via PostgREST RPC when called with either the
-- service role (server) or in future from anon if we ever expose it.
GRANT EXECUTE ON FUNCTION next_order_number() TO service_role;

COMMENT ON FUNCTION next_order_number() IS
  '回傳下一筆訂單編號（8 位數，零補位）。新版 checkout 用，舊 WP/RR 訂單編號保留不動。';
