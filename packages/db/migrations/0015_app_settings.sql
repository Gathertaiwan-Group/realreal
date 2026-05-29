-- 0015_app_settings.sql
-- Runtime-editable app settings for payment/invoice/logistics/notification
-- credentials. Spec: docs/superpowers/specs/2026-05-30-admin-runtime-settings-design.md

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  -- AES-256-GCM ciphertext: base64(iv || ciphertext || authTag)
  value_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS app_settings_audit (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  action TEXT NOT NULL,            -- "set" | "unset"
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Intentionally does NOT store old or new value — audit must not be the
  -- source of a secret leak.
);

CREATE INDEX IF NOT EXISTS idx_app_settings_audit_changed_at
  ON app_settings_audit (changed_at DESC);

-- RLS: only the service role touches these via the API. Block everything
-- from anon / authenticated by default.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings_audit ENABLE ROW LEVEL SECURITY;
-- No policies → no rows visible to non-service-role clients. Service role
-- bypasses RLS automatically.
