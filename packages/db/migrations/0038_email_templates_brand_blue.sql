-- 0038_email_templates_brand_blue.sql
--
-- All transactional email templates were seeded (0012_email_templates.sql) with
-- a sage-green brand color #4a7c59 on the "誠真生活 RealReal" header (<h1> color
-- + border) and the CTA buttons. The brand color is navy blue #10305a (used
-- everywhere else on the site and in the hardcoded apps/api/src/emails/*.ts
-- fallback templates). renderAndSendEmail() prefers the DB/CMS template, so the
-- live emails render green.
--
-- Recolor every email template stored in site_contents to the brand blue.
-- Targets ONLY the green hex, so the red (#e53e3e) "更新付款資訊" button on the
-- subscription-failed template is intentionally left alone.
--
-- Idempotent: a no-op once no #4a7c59 remains. Safe to re-run.
UPDATE site_contents
SET value = REPLACE(value::text, '#4a7c59', '#10305a')::jsonb
WHERE key LIKE 'email_%'
  AND value::text LIKE '%#4a7c59%';
