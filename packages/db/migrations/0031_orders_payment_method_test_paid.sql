-- 0031: Extend orders.payment_method CHECK to allow 'test_paid'
--
-- Background: apps/api/src/routes/orders.ts POST / now supports a sandbox
-- payment method "test_paid" (admin-only) which skips the gateway redirect
-- but runs the full post-payment pipeline (enqueuePostPaymentJobs). The DB
-- CHECK constraint originally hard-coded 4 gateways and rejected the new
-- value, causing every admin sandbox checkout to fail with
-- 'orders_payment_method_check' violation.
--
-- Already applied to production via Supabase Management API.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;

ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method = ANY (ARRAY[
    'pchomepay'::text,
    'linepay'::text,
    'jkopay'::text,
    'cvs_cod'::text,
    'test_paid'::text
  ]));
