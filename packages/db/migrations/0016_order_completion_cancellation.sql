-- 完成 / 取消 時間戳 + 原因（為了 audit + 退款工單）
ALTER TABLE orders
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancel_reason TEXT,
  ADD COLUMN failed_reason TEXT;

-- 註：payments.status 與 logistics.status 都是 TEXT 無 CHECK constraint
-- （見 0001_initial.sql 第 106、121 行），所以新值 'refund_requested' /
-- 'cancelled' / 'returned' 直接寫入即可，本 migration 無需改 schema，
-- 只列在這裡文件化新合法值集合。

-- Backfill：把 status='completed' 但無 completed_at 的舊單填上 updated_at
UPDATE orders SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;

UPDATE orders SET cancelled_at = updated_at
WHERE status = 'cancelled' AND cancelled_at IS NULL;
