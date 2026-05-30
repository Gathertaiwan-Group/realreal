# Spec H — auth.users → user_profiles 自動 trigger

**Date:** 2026-05-31
**Status:** Draft → user already approved option A (DB trigger)
**Touches:** packages/db (1 migration)
**Scope:** tiny — ~50 LOC

## Why

Critical bug discovered while answering 「會員註冊流程長怎樣？」：

- `/auth/register` → `supabase.auth.signUp` → 創建 auth.users row + 寄 confirm email + 點連結 → session set → redirect "/" ✅
- **但 user_profiles 完全沒人建** — 無 DB trigger、無 middleware、無 callback hook、無 application code
- 53 個既有 profile **全部來自 migration 0007 一次性 import**；migration 後**零新會員註冊過**（live DB query 證明）

新會員 signup 後所有依 `user_profiles.membership_tier_id` 的功能炸：
- /my-account 顯示 N/A
- 結帳 tier discount = 0
- 點數 grant 找不到 profile 跳過
- spec C 新加的 tier_expires_at / period_spend 不會寫
- /admin/customers 列表看不到

## Locked decisions
- 修法 **A：DB trigger**（user 已選）
- 預設 tier = `初心之友`（或 min_spend = 0 的最低等級，依名稱 lookup 不到時 fallback）
- 預設 role = `customer`
- tier_expires_at = NULL（初心永久）
- tier_started_at = NOW
- display_name 從 `raw_user_meta_data->>'display_name'`（signUp options.data 設的）

## Scope

### IN
1. Migration 0022 — `handle_new_user()` SQL function + trigger `on_auth_user_created`
2. Backfill SAFETY — query 後若有 auth.users without profile 也建（預期 0 筆，純保險）
3. Idempotent — trigger 用 `ON CONFLICT (user_id) DO NOTHING` 防重跑

### OUT
- 後端 lazy-create fallback (DB trigger 永遠先跑，不需要)
- email confirmation success hook (沒必要；trigger 在 auth.users insert 當下就跑)
- 升等 tier 通知 email (新會員第一次入會不算升等)

## Design

`packages/db/migrations/0022_auth_user_profile_trigger.sql`:

```sql
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
```

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0022_auth_user_profile_trigger.sql` |

預估 ~50 LOC migration / 0 code change

## Validation

1. 套用後 verify：`SELECT proname FROM pg_proc WHERE proname='handle_new_user';` 應有 1 row
2. `SELECT tgname FROM pg_trigger WHERE tgname='on_auth_user_created';` 應有 1 row
3. 模擬：用 Supabase auth admin create user → 立即 query user_profiles 應有對應 row + 初心 tier
4. 既有 53 個 user_profile 都還在（trigger 不影響舊資料）

## Known caveats

- 若 admin 在 Supabase Dashboard 用 SQL `INSERT INTO auth.users` 而非 supabase.auth signUp，`raw_user_meta_data` 通常為空 → display_name=NULL → admin 後台會看到「—」。可接受。
- 若 membership_tiers 表空（不該發生）→ default_tier_id NULL → trigger 仍插入 row 但 tier_id = NULL；admin 須手動指派。
- SECURITY DEFINER 讓 function 以表 owner 權限執行 — 用於跨 schema (auth → public) 寫入。Supabase 官方 cookbook 也是同樣模式。
