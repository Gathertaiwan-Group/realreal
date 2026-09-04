-- 會員生日：註冊時選填、設定後不可自行修改
--
-- 生日折扣（birthday_bonus）評估器與三個活動早就上線了，但 187 位會員只有 10
-- 位有生日資料 —— 因為前台從來沒有地方可以填。這份 migration 補上兩件事。
--
-- 為什麼「不能改」一定要做在資料庫：會員資料是前端用 anon key 直接寫
-- user_profiles 的（AccountSettingsSection 就是 supabase.from(...).update(...)），
-- 沒有經過我們的 API。只把輸入框設成唯讀，等於把鎖掛在門外 —— 從瀏覽器主控台
-- 呼叫一次 update 就能改。生日視窗有 31 天，可以自由改生日就等於全年都能領禮金。

-- 1) 註冊時填的生日，跟著帶進 user_profiles。
--
-- 註冊是 supabase.auth.signUp({ options: { data: { birthday } } })，值先落在
-- auth.users.raw_user_meta_data。既有的建檔 trigger 只搬 display_name，這裡用一個
-- 獨立的 BEFORE INSERT trigger 把生日補上，不去改動既有那支函式。
create or replace function public.copy_birthday_from_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.birthday is null then
    begin
      select nullif(u.raw_user_meta_data->>'birthday', '')::date
        into new.birthday
        from auth.users u
       where u.id = new.user_id;
    exception when others then
      -- 生日格式壞掉不能讓註冊整個失敗；寧可沒有生日，也不要建不了帳號。
      new.birthday := null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_copy_birthday on public.user_profiles;
create trigger user_profiles_copy_birthday
  before insert on public.user_profiles
  for each row execute function public.copy_birthday_from_signup();

-- 2) 生日設定後鎖定。
--
-- 只擋一般登入的會員（authenticated）。後台改生日走的是 service_role
-- (PATCH /admin/customers/:id/profile)，Supabase SQL Editor 沒有 JWT，兩者都放行
-- —— 客人寫錯要更正時，客服改得動。
create or replace function public.lock_birthday_once()
returns trigger
language plpgsql
as $$
begin
  if old.birthday is not null
     and new.birthday is distinct from old.birthday
     and coalesce(auth.role(), 'service_role') = 'authenticated' then
    raise exception '生日設定後不可修改，如需更正請聯絡客服'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_lock_birthday on public.user_profiles;
create trigger user_profiles_lock_birthday
  before update on public.user_profiles
  for each row execute function public.lock_birthday_once();

-- 3) 明顯不合理的生日擋掉（未來日期、1900 年以前）。
--
-- 這段不能寫成 CHECK constraint：Postgres 要求 CHECK 裡的函式必須是 IMMUTABLE，
-- 而 current_date 不是（同一列資料今天合法、明天可能就不合法，索引與 dump/restore
-- 都會出問題）。所以用 trigger 驗，插入與更新都走同一段。
create or replace function public.validate_birthday()
returns trigger
language plpgsql
as $$
begin
  if new.birthday is not null
     and (new.birthday > current_date or new.birthday <= date '1900-01-01') then
    raise exception '生日日期不合理：%', new.birthday
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists user_profiles_validate_birthday on public.user_profiles;
create trigger user_profiles_validate_birthday
  before insert or update on public.user_profiles
  for each row execute function public.validate_birthday();
