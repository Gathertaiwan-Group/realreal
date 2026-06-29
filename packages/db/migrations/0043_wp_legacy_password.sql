-- 0043: WordPress legacy password fallback + WP user mapping
--
-- Background: importing 72 users + 129 orders from the WordPress backup
-- (realreal.cc_wpvivid-...-2026-06-30). WP uses PHPass portable hashes
-- ($P$...) which Supabase Auth (bcrypt) can't verify directly. Approach:
--   - Generate a random secure password for each imported user
--   - Store the original PHPass hash in user_profiles.wp_legacy_password_hash
--   - Login action falls back to PHPass verify when Supabase reports
--     "Invalid login credentials". On success, admin-update password to
--     user's typed value (now bcrypt) and clear the legacy hash.
--
-- Once cleared, the user is fully migrated to bcrypt and the row is
-- indistinguishable from a native signup.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS wp_legacy_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS wp_legacy_user_id BIGINT,
  ADD COLUMN IF NOT EXISTS wp_legacy_user_login TEXT,
  ADD COLUMN IF NOT EXISTS wp_imported_at TIMESTAMPTZ;

-- Index so the legacy-login fallback can find a profile by email quickly.
-- The actual email lives on auth.users; we already JOIN through user_id,
-- but a partial index on rows where wp_legacy_password_hash IS NOT NULL
-- keeps the lookup tight (only ~72 rows even with all imports).
CREATE INDEX IF NOT EXISTS idx_user_profiles_wp_legacy_pending
  ON user_profiles(user_id)
  WHERE wp_legacy_password_hash IS NOT NULL;

COMMENT ON COLUMN user_profiles.wp_legacy_password_hash IS
  'PHPass hash from WordPress wp_users.user_pass. Verified on first login fallback then cleared after re-hash to bcrypt via admin.updateUserById.';
COMMENT ON COLUMN user_profiles.wp_legacy_user_id IS
  'Original WordPress wp_users.ID — kept for audit / cross-reference with imported orders.';
