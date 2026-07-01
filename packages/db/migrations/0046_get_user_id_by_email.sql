-- get_user_id_by_email(email) — 用來在訪客結帳時 auto-link 訂單到已存在的帳號。
--
-- Why: anon / authenticated 角色沒權限讀 auth.users，但 checkout 需要在建
-- guest order 前查 email 有沒有對應到既有帳號（避免像 10000011/10000012
-- 那種情況：yinhsin 是 VIP，訪客結帳因為 email match，訂單卻掛 guest。
-- Service role 也可直接讀 auth.users，但改走 RPC 讓「未來從 service role
-- 以外的地方叫用」是可能的。
--
-- SECURITY DEFINER：函式以 owner (postgres) 身份執行，繞過 anon 的 RLS。
-- 因此只回 uuid 沒有其他欄位，最小暴露面。

CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users
  WHERE LOWER(email) = LOWER(p_email)
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(TEXT) TO service_role;
