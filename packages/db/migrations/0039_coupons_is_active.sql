-- 0039_coupons_is_active.sql
--
-- Fix: 後台新增優惠券 → [500] Could not find the 'is_active' column of
-- 'coupons' in the schema cache.
--
-- Root cause: the `coupons` table (0001_initial.sql) was never given an
-- `is_active` column, but the API (apps/api/src/routes/coupons.ts) and the
-- admin UI (apps/web/.../admin/coupons, kols/CouponPicker) all read and write
-- coupons.is_active. The list endpoint uses select("*") so it silently tolerates
-- the missing column, but POST /admin/coupons INSERTs `is_active: true`
-- explicitly → PostgREST rejects it with a schema-cache error.
--
-- Backfilling DEFAULT TRUE makes every existing coupon active, which matches the
-- code's intent (a coupon with no is_active flag was always treated as enabled).
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-running is safe.

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Tell PostgREST to reload its schema cache immediately so the new column is
-- visible without waiting for the next auto-reload (avoids a transient repeat of
-- the same "schema cache" error right after the migration).
NOTIFY pgrst, 'reload schema';
