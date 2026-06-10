-- 0035: Account-bound saved address book.
--
-- Until now the checkout "address book" lived only in browser localStorage
-- (key: realreal_addresses), so saved addresses did not follow the customer
-- across devices/browsers. This table moves it server-side, scoped per user
-- via RLS, so a logged-in customer sees the same addresses everywhere.
--
-- Frontend reads/writes this table directly through the Supabase client
-- (same pattern as user_profiles); RLS is the only access control.
--
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS user_addresses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  city         TEXT NOT NULL DEFAULT '',
  district     TEXT NOT NULL DEFAULT '',
  postal_code  TEXT NOT NULL DEFAULT '',
  address_line TEXT NOT NULL DEFAULT '',
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_addresses_user_id_idx ON user_addresses(user_id);

-- Keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION set_user_addresses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_addresses_set_updated_at ON user_addresses;
CREATE TRIGGER user_addresses_set_updated_at
  BEFORE UPDATE ON user_addresses
  FOR EACH ROW
  EXECUTE FUNCTION set_user_addresses_updated_at();

-- Row Level Security: a user may only see and mutate their own rows.
ALTER TABLE user_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_addresses_select_own ON user_addresses;
CREATE POLICY user_addresses_select_own ON user_addresses
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_addresses_insert_own ON user_addresses;
CREATE POLICY user_addresses_insert_own ON user_addresses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_addresses_update_own ON user_addresses;
CREATE POLICY user_addresses_update_own ON user_addresses
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_addresses_delete_own ON user_addresses;
CREATE POLICY user_addresses_delete_own ON user_addresses
  FOR DELETE USING (auth.uid() = user_id);
