ALTER TABLE products ADD COLUMN IF NOT EXISTS min_tier_id uuid REFERENCES membership_tiers(id);
