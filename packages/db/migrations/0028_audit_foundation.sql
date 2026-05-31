-- 0028_audit_foundation.sql
-- Phase 1 of audit findings: idempotency, integrity guards, indexes, and atomic RPCs.

-- ---------------------------------------------------------------------------
-- 1. Order idempotency keys
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_idempotency_keys (
  key           text PRIMARY KEY,
  user_id       uuid NULL,
  guest_email   text NULL,
  order_id      uuid NULL REFERENCES orders(id) ON DELETE SET NULL,
  status_code   int  NOT NULL DEFAULT 200,
  response_body jsonb NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires
  ON order_idempotency_keys(expires_at);

-- ---------------------------------------------------------------------------
-- 2. Orders columns
-- ---------------------------------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipping_zeroed_by_campaign boolean NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS first_purchase_applied boolean NOT NULL DEFAULT false;

-- One first-purchase order per user (NULL user_id rows are excluded)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_first_purchase_per_user
  ON orders(user_id)
  WHERE first_purchase_applied = true AND user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Supporting indexes
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_order_number
  ON orders(order_number);

CREATE INDEX IF NOT EXISTS idx_orders_user_created
  ON orders(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_points_ledger_user
  ON points_ledger(user_id);

CREATE INDEX IF NOT EXISTS idx_points_ledger_source_expires
  ON points_ledger(source, expires_at);

CREATE INDEX IF NOT EXISTS idx_campaigns_active_window
  ON campaigns(is_active, starts_at, ends_at);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_coupons_code
  ON coupons(code);

CREATE INDEX IF NOT EXISTS idx_kols_slug_active
  ON kols(slug, is_active);

-- ---------------------------------------------------------------------------
-- 4. Atomic RPCs
-- ---------------------------------------------------------------------------

-- Atomically increment coupon usage if still valid. Returns true on success.
CREATE OR REPLACE FUNCTION atomic_increment_coupon_usage(p_coupon_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_affected int;
BEGIN
  UPDATE coupons
     SET used_count = used_count + 1
   WHERE id = p_coupon_id
     AND (max_uses IS NULL OR used_count < max_uses)
     AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected > 0;
END;
$$;

-- Atomically deduct stock for an array of variants.
-- Input shape: [{ "id": "<uuid>", "qty": <int> }, ...]
-- Locks all rows FOR UPDATE in id order (deadlock-safe), then deducts each.
-- Raises P0001 if any variant has insufficient stock.
CREATE OR REPLACE FUNCTION atomic_deduct_stock(p_variants jsonb)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_ids        uuid[];
  v_rec        record;
  v_affected   int;
BEGIN
  -- Collect & sort variant ids for deterministic locking order
  SELECT array_agg((elem->>'id')::uuid ORDER BY (elem->>'id')::uuid)
    INTO v_ids
    FROM jsonb_array_elements(p_variants) AS elem;

  -- Lock all target rows up front
  PERFORM 1
     FROM product_variants
    WHERE id = ANY(v_ids)
    ORDER BY id
    FOR UPDATE;

  -- Deduct each variant
  FOR v_rec IN
    SELECT (elem->>'id')::uuid  AS vid,
           (elem->>'qty')::int  AS qty
      FROM jsonb_array_elements(p_variants) AS elem
  LOOP
    UPDATE product_variants
       SET stock_qty = stock_qty - v_rec.qty
     WHERE id = v_rec.vid
       AND stock_qty >= v_rec.qty;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN
      RAISE EXCEPTION 'insufficient stock for variant %', v_rec.vid USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- Atomically restore stock (e.g. on cancellation/refund).
CREATE OR REPLACE FUNCTION atomic_restore_stock(p_variants jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT (elem->>'id')::uuid  AS vid,
           (elem->>'qty')::int  AS qty
      FROM jsonb_array_elements(p_variants) AS elem
  LOOP
    UPDATE product_variants
       SET stock_qty = stock_qty + v_rec.qty
     WHERE id = v_rec.vid;
  END LOOP;
END;
$$;
