-- Migration 0022: auth.users → user_profiles auto-create trigger
--
-- Spec: docs/superpowers/specs/2026-05-31-H-auth-user-profile-trigger-design.md
--
-- Why: New signups via supabase.auth.signUp created auth.users rows but no
-- matching user_profiles row, so membership_tier_id / role / spend tracking
-- silently broke. This installs a DB-level trigger so every new auth.users
-- insert provisions a default-tier customer profile. Includes a defensive
-- backfill for any pre-existing auth.users without a profile (expected 0).
--
-- See spec "Design" section for full rationale and locked decisions.

-- Create function that runs on new auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_tier_id UUID;
BEGIN
  -- Find the lowest-tier ID (初心之友 / 一般會員 / whatever has min_spend=0)
  SELECT id INTO default_tier_id
  FROM public.membership_tiers
  ORDER BY min_spend ASC
  LIMIT 1;

  INSERT INTO public.user_profiles (
    user_id,
    display_name,
    membership_tier_id,
    role,
    tier_started_at,
    tier_expires_at,
    tier_period_spend,
    total_spend,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'display_name',
    default_tier_id,
    'customer',
    NOW(),
    NULL,  -- 初心永久 (validity_months=0)
    0,
    0,
    NOW()
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger fires after auth.users insert
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Backfill: any existing auth.users without a profile (defensive; expect 0)
INSERT INTO public.user_profiles (user_id, display_name, membership_tier_id, role, tier_started_at, total_spend, created_at)
SELECT
  u.id,
  u.raw_user_meta_data->>'display_name',
  (SELECT id FROM public.membership_tiers ORDER BY min_spend ASC LIMIT 1),
  'customer',
  COALESCE(u.created_at, NOW()),
  0,
  COALESCE(u.created_at, NOW())
FROM auth.users u
LEFT JOIN public.user_profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL;
