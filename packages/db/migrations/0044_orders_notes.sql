-- 0044: Add orders.notes column for customer order notes (custom flavor
-- requests, delivery instructions, etc.).
--
-- Background: commit 325ae94 (feat(checkout): add order notes field for
-- custom flavor requests) wired up the frontend + apps/api/src/routes/orders.ts
-- to accept and persist a `notes` field on POST /orders, but the DB migration
-- was never written. Every checkout since hits PGRST204
--   "Could not find the 'notes' column of 'orders' in the schema cache"
-- and bounces back to the user as "failed to create order". This migration
-- backfills the missing column.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN orders.notes IS
  '顧客下單時填寫的備註欄（口味客製、配送指示等）。最長 500 字元（zod schema 在 API 端限制）。';
