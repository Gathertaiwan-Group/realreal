-- =====================================================================
-- 0036  CRITICAL SECURITY FIX — enable Row-Level Security everywhere.
--
-- BEFORE this migration: RLS was OFF on every public table while the
-- browser holds the Supabase `anon` key. Any unauthenticated visitor
-- could `GET /rest/v1/order_addresses` and dump every customer's name,
-- phone, address, email, order history, points, payments and invoices.
-- This closes that hole.
--
-- Model (verified against the codebase):
--   • The API uses the service_role key → BYPASSES RLS entirely, so all
--     server-side writes/reads keep working untouched.
--   • The web app reads only 10 tables directly with the user's session;
--     everything else it gets through the API. Web does exactly ONE
--     direct write: a user editing their own profile (display_name/phone).
--   • So: owner/admin SELECT policies on PII tables, public SELECT on
--     catalog/content, lock the rest to service_role, and one tightly
--     column-scoped self-update on user_profiles.
--
-- Reversible: `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` if needed.
-- =====================================================================

-- ── Admin check (SECURITY DEFINER so it can read role under RLS) ──────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.user_id = auth.uid() AND up.role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- GROUP A — PUBLIC content (anyone may SELECT; writes are service_role
-- only, since enabling RLS with no write policy denies anon/authenticated
-- writes by default). These hold no PII.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products','product_variants','categories','membership_tiers',
    'subscription_plans','campaigns','site_contents','posts',
    'post_categories','post_tags','post_tag_links','product_reviews','media'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_public_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (true);',
        t||'_public_read', t);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- GROUP B — OWNER-scoped PII (a user sees only their own rows; admins see
-- all; service_role writes). Tables with a direct user_id column.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','points_ledger','subscriptions'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_owner_admin_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (user_id = auth.uid() OR public.is_admin());',
        t||'_owner_admin_read', t);
    END IF;
  END LOOP;
END $$;

-- ── user_profiles: owner/admin read + tightly column-scoped self-update ─
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_owner_admin_read ON public.user_profiles;
CREATE POLICY user_profiles_owner_admin_read ON public.user_profiles
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS user_profiles_self_update ON public.user_profiles;
CREATE POLICY user_profiles_self_update ON public.user_profiles
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Column-level: even on their own row, a customer may only change these
-- two fields — NOT role / total_spend / membership_tier_id / tier_* /
-- charity_savings. This kills the self-promotion-to-admin vector.
REVOKE UPDATE ON public.user_profiles FROM authenticated;
GRANT  UPDATE (display_name, phone) ON public.user_profiles TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- GROUP C — order/subscription CHILD tables (ownership via the parent).
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_items','order_addresses','payments','invoices','logistics'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_owner_admin_read', t);
      EXECUTE format($f$
        CREATE POLICY %I ON public.%I FOR SELECT USING (
          public.is_admin() OR EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = %I.order_id AND o.user_id = auth.uid()
          )
        );$f$, t||'_owner_admin_read', t, t);
    END IF;
  END LOOP;
END $$;

-- subscription_orders & coupon_uses (ownership via subscription/order/user)
ALTER TABLE public.subscription_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscription_orders_owner_admin_read ON public.subscription_orders;
CREATE POLICY subscription_orders_owner_admin_read ON public.subscription_orders
  FOR SELECT USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.id = subscription_orders.subscription_id AND s.user_id = auth.uid()
    )
  );

DO $$ BEGIN
  IF to_regclass('public.coupon_uses') IS NOT NULL THEN
    ALTER TABLE public.coupon_uses ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS coupon_uses_owner_admin_read ON public.coupon_uses;
    CREATE POLICY coupon_uses_owner_admin_read ON public.coupon_uses
      FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- GROUP D — ADMIN-ONLY readable (no anon, no customer). Coupons (code
-- harvesting), KOL profit/contact data, click analytics. Storefront gets
-- what it needs (e.g. /k/[slug]) through the service_role API.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['coupons','kols','kol_clicks'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t||'_admin_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_admin());',
        t||'_admin_read', t);
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- GROUP E — INTERNAL tables: enable RLS with NO policy at all → only
-- service_role (which bypasses RLS) can touch them. anon/authenticated
-- get nothing.
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'order_post_payment_log','order_idempotency_keys','webhook_events',
    'schema_migration_markers'
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- ── Make the points-balance VIEW respect the underlying RLS ───────────
-- Postgres 15+: security_invoker runs the view as the querying user, so
-- it returns only that user's points instead of bypassing RLS as owner.
DO $$ BEGIN
  IF to_regclass('public.v_user_points_balance') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.v_user_points_balance SET (security_invoker = on)';
  END IF;
END $$;
