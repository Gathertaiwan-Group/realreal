-- Migration 0024: Category landing-page fields (banner / tagline / features / related posts)
--
-- Spec: docs/superpowers/specs/2026-05-31-J-category-page-fruit-shop-style-design.md (Section 1)
--
-- Purpose:
--   The current /shop?category=X view is just a title + product grid + sort dropdown.
--   Spec J reshapes each category into a fruit-shop-style landing page with:
--     - full-width banner image
--     - large tagline + subtitle
--     - 3 benefit/feature blocks (heading + body)
--     - related blog posts ("大家都在看")
--   These are all admin-editable per category. This migration adds the underlying
--   columns + backfills the freeze-dried (凍乾水果) row with the verbatim copy from
--   the legacy WordPress page at https://realreal.cc/fruit-shop/.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS banner_url TEXT,
  ADD COLUMN IF NOT EXISTS tagline TEXT,          -- main hero 大字 e.g. "為你的笑容，鎖住每一口純粹"
  ADD COLUMN IF NOT EXISTS subtitle TEXT,         -- 副標 e.g. "孩子的笑容，是世界上最純粹的能量。"
  ADD COLUMN IF NOT EXISTS feature_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- shape: [{ "heading": "...", "body": "..." }, ...] up to 3 entries
  ADD COLUMN IF NOT EXISTS related_post_slugs TEXT[] NOT NULL DEFAULT '{}';
  -- explicit post slug list; if empty, fallback to recent 4 posts WHERE category matches

-- Backfill freeze-dried 凍乾水果 per realreal.cc/fruit-shop content
UPDATE categories SET
  tagline = '為你的笑容，鎖住每一口純粹',
  subtitle = '孩子的笑容，是世界上最純粹的能量。',
  feature_blocks = '[
    {"heading": "每一片水果，都是自然的禮物", "body": "採用低溫凍乾技術，鎖住維生素與膳食纖維，零添加物、零香料，每一口都是水果本身的甘甜。"},
    {"heading": "全年齡皆宜的快樂零食", "body": "從早餐果碗、健身點心，到露營與登山補給，凍乾水果是各種場景的營養好夥伴。"},
    {"heading": "先進凍乾技術，完整鎖住營養", "body": "獨家凍乾工藝在保留新鮮口感的同時，最大化保存水果原有的維生素與礦物質。"}
  ]'::jsonb
WHERE slug = 'freeze-dried';
