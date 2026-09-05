-- 通路商批發訂單系統 — 第一階段資料結構
--
-- 設計依據：docs/superpowers/specs/2026-08-26-wholesale-channel-portal-design.md
-- 與 2026-09-04 的補充決定：
--   * 各通路商價格「略有不同」→ 標準價一份 + 個別例外，不是每家一套完整價目表
--   * 標準價採松泰藥局 2026-07-28 那份報價單
--   * 銀杏水蜜桃比照果真草莓
--   * 報價單由系統產出，所以「定價」（給通路商的建議零售價）必須進資料庫
--
-- 批發價是商業機密，這三張表一律不開放前台讀取（RLS 開啟且不建任何 policy →
-- 只有 service-role 進得來）。

-- ---------------------------------------------------------------------------
-- 1) 通路商
-- ---------------------------------------------------------------------------
create table if not exists public.wholesale_channels (
  id            uuid primary key default gen_random_uuid(),
  -- 先建檔、之後再開登入帳號也可以，所以允許 null
  user_id       uuid unique references auth.users(id) on delete set null,
  name          text not null,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  tax_id        text,
  -- 付款條件：收貨後 3 個工作天，或月底結
  payment_terms text not null default 'on_receipt_3d'
                check (payment_terms in ('on_receipt_3d', 'month_end')),
  -- 轉售價格下限（合約條款，印在報價單上；松泰是 60 / 350，其他家可能沒有）
  msrp_floor_sachet integer,
  msrp_floor_pouch  integer,
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) 標準批發價（每個規格一列；沒有列 = 不開放批發）
-- ---------------------------------------------------------------------------
-- 「商品可見範圍」直接由這張表決定：組合商品不會有列，所以自然不會出現在
-- 批發品項裡，不需要另外一個「是不是組合商品」的欄位去判斷。
create table if not exists public.wholesale_prices (
  variant_id      uuid primary key references public.product_variants(id) on delete cascade,
  list_price      integer not null,   -- 定價（建議零售價，印在報價單）
  wholesale_price integer not null,   -- 標準批發價
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3) 個別通路商的差異（例外價 / 不供貨）
-- ---------------------------------------------------------------------------
-- 一列 = 這家在這個品項上跟標準不一樣，差別可能是價格、可能是根本不進貨、也可能
-- 兩者都是。只存「不一樣的」，相同的一列都不佔。
--
--   wholesale_price 有值 → 用這個價；null → 用標準價
--   is_available = false → 這家不進這個品項，訂單頁與報價單都不出現
--
-- 為什麼可用性也放這張表：原粹蔬食作完全不賣夾鏈袋。設計文件原本把「各通路商
-- 可見範圍不同」列為排除項目，但實際談下來第一家就需要，與其另開一張表，不如
-- 讓「這家的例外」有一個地方放完。
--
-- 取價一律 coalesce(這裡的價, 標準價)。刪掉一列 = 這家完全回到標準，這也是為什麼
-- 後台一定要有「恢復標準」的動作：否則「與標準相同」和「剛好填了同一個數字」在
-- 資料上分不出來，日後全面調價時後者不會跟著變。
create table if not exists public.wholesale_channel_items (
  channel_id      uuid    not null references public.wholesale_channels(id) on delete cascade,
  variant_id      uuid    not null references public.product_variants(id) on delete cascade,
  wholesale_price integer,                        -- null = 沿用標準批發價
  is_available    boolean not null default true,  -- false = 這家不進這個品項
  updated_at      timestamptz not null default now(),
  primary key (channel_id, variant_id),
  -- 一列如果既沒改價、又照常供貨，那它沒有存在的意義
  constraint wholesale_channel_items_meaningful
    check (wholesale_price is not null or is_available = false)
);

create index if not exists wholesale_channel_items_channel_idx
  on public.wholesale_channel_items (channel_id);

-- ---------------------------------------------------------------------------
-- 4) 訂單分流
-- ---------------------------------------------------------------------------
-- order_type 是所有報表的第一層篩選：通路商數字與零售數字絕不能互相汙染。
-- 既有訂單全部視為 retail。
alter table public.orders
  add column if not exists order_type text not null default 'retail'
    check (order_type in ('retail', 'wholesale'));

alter table public.orders
  add column if not exists wholesale_channel_id uuid
    references public.wholesale_channels(id) on delete set null;

-- 應收帳款：出貨時附帳單，收貨後 3 個工作天或月底付款。
-- 收款與出貨是兩條獨立的線，所以不塞進既有的 payment_status 狀態機。
alter table public.orders
  add column if not exists wholesale_due_date date;
alter table public.orders
  add column if not exists wholesale_paid_at timestamptz;

create index if not exists orders_order_type_idx on public.orders (order_type);
create index if not exists orders_wholesale_channel_idx
  on public.orders (wholesale_channel_id) where wholesale_channel_id is not null;

-- ---------------------------------------------------------------------------
-- 5) RLS：批發價不對外
-- ---------------------------------------------------------------------------
alter table public.wholesale_channels          enable row level security;
alter table public.wholesale_prices            enable row level security;
alter table public.wholesale_channel_items      enable row level security;
-- 刻意不建立任何 policy：anon 與 authenticated 一律讀不到，只有 service-role
-- （後端 API）進得來。第二階段開放通路商自助下單時，再加一條「只能看到自己那家」
-- 的 policy。

-- ---------------------------------------------------------------------------
-- 6) 標準批發價：松泰藥局 2026-07-28 報價單，銀杏水蜜桃比照果真草莓
-- ---------------------------------------------------------------------------
insert into public.wholesale_prices (variant_id, list_price, wholesale_price) values
  -- 50 克隨身包（定價 67）
  ('a16bf487-1074-48bf-b340-87125a2b99e4', 67,  40),  -- 初心原味
  ('8f2e3146-9e23-44a1-ac2f-0fc6d880ca8d', 67,  46),  -- 可可
  ('d1c490eb-d8ca-4438-a5f5-2ece23ba02bf', 67,  46),  -- 果真草莓
  ('b8242f24-4087-45c1-a1e0-5dfe4705025f', 67,  46),  -- 杏仁火龍果
  ('caa4c589-1a88-4e96-992c-2e262e373b84', 67,  46),  -- 芝麻藍莓
  ('61aab8e3-b290-49fa-a7ab-a54fbc466aa9', 67,  46),  -- 銀杏水蜜桃
  -- 300 克夾鏈袋（定價 400）
  ('93c40b9e-632a-46b7-b34d-03d228aa2f82', 400, 211), -- 初心原味
  ('20b7ea8b-4ae9-46c9-9def-e9fbb3b1b6b7', 400, 243), -- 可可
  ('867293d6-85c9-4b7a-921c-8bdfbd688d57', 400, 243), -- 果真草莓
  ('8b6bdf71-77bd-411d-a5c8-e92b80aff2c1', 400, 243), -- 杏仁火龍果
  ('32836ed1-ded6-470e-9a8b-25c7da8e9ead', 400, 243), -- 芝麻藍莓
  ('5f54af30-7c9f-4226-beb2-7a4a71dd74a3', 400, 243)  -- 銀杏水蜜桃
on conflict (variant_id) do update
  set list_price = excluded.list_price,
      wholesale_price = excluded.wholesale_price,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 7) 五家通路商
-- ---------------------------------------------------------------------------
-- 統編、聯絡人、地址之後補；先建檔才能開始建單。user_id 留空，等第二階段開放
-- 自助下單時再綁帳號。
insert into public.wholesale_channels
  (name, contact_name, payment_terms, msrp_floor_sachet, msrp_floor_pouch, notes)
values
  ('松泰藥師藥局', '江先生', 'on_receipt_3d', 60, 350,
   '標準批發價的來源（2026-07-28 報價單）。合約載明轉售價不得低於隨身包 60、夾鏈袋 350。'),
  ('知竹藥局', '陳玄臻藥師', 'on_receipt_3d', null, null,
   '2026-05-29 報價單：夾鏈袋另有議價。該份報價單的「定價」欄為舊版，已作廢不採用。'),
  ('原粹蔬食作', null, 'on_receipt_3d', null, null,
   '隨身包六種口味一律 51 元（高於標準價）。'),
  ('探索天然蔬適集', null, 'on_receipt_3d', null, null,
   '報價單尚未提供，暫按標準批發價；正式下單前需確認。'),
  ('新埔健保藥局', null, 'on_receipt_3d', null, null,
   '初心原味走標準價；其餘口味隨身包 45、夾鏈袋 240。')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 8) 各家的差異
-- ---------------------------------------------------------------------------
-- 松泰藥師藥局：0 列 —— 它就是標準價。
-- 探索天然蔬適集、新埔健保藥局：0 列 —— 報價單尚未提供，暫用標準價。
--
-- 銀杏水蜜桃是新口味，尚未跟任何通路商議價，預計一律報 243（夾鏈袋）。標準價
-- 已經是 243，所以沒有人需要例外列。

-- 知竹藥局：夾鏈袋議價（隨身包與標準價相同，不列）。
-- 銀杏水蜜桃夾鏈袋不列 → 走標準價 243，與「新口味統一報 243」一致。
insert into public.wholesale_channel_items (channel_id, variant_id, wholesale_price)
select c.id, v.variant_id, v.price
from public.wholesale_channels c
cross join (values
  ('93c40b9e-632a-46b7-b34d-03d228aa2f82'::uuid, 185),  -- 初心原味 300g
  ('20b7ea8b-4ae9-46c9-9def-e9fbb3b1b6b7'::uuid, 240),  -- 可可 300g
  ('867293d6-85c9-4b7a-921c-8bdfbd688d57'::uuid, 240),  -- 果真草莓 300g
  ('8b6bdf71-77bd-411d-a5c8-e92b80aff2c1'::uuid, 240),  -- 杏仁火龍果 300g
  ('32836ed1-ded6-470e-9a8b-25c7da8e9ead'::uuid, 240)   -- 芝麻藍莓 300g
) as v(variant_id, price)
where c.name = '知竹藥局'
on conflict (channel_id, variant_id) do update
  set wholesale_price = excluded.wholesale_price,
      is_available = true,
      updated_at = now();

-- 原粹蔬食作：隨身包一律 51（含初心原味，標準價 40），銀杏水蜜桃 55；
-- 夾鏈袋完全不進貨。
insert into public.wholesale_channel_items (channel_id, variant_id, wholesale_price)
select c.id, v.variant_id, v.price
from public.wholesale_channels c
cross join (values
  ('a16bf487-1074-48bf-b340-87125a2b99e4'::uuid, 51),  -- 初心原味 50g
  ('8f2e3146-9e23-44a1-ac2f-0fc6d880ca8d'::uuid, 51),  -- 可可 50g
  ('d1c490eb-d8ca-4438-a5f5-2ece23ba02bf'::uuid, 51),  -- 果真草莓 50g
  ('b8242f24-4087-45c1-a1e0-5dfe4705025f'::uuid, 51),  -- 杏仁火龍果 50g
  ('caa4c589-1a88-4e96-992c-2e262e373b84'::uuid, 51),  -- 芝麻藍莓 50g
  ('61aab8e3-b290-49fa-a7ab-a54fbc466aa9'::uuid, 55)   -- 銀杏水蜜桃 50g
) as v(variant_id, price)
where c.name = '原粹蔬食作'
on conflict (channel_id, variant_id) do update
  set wholesale_price = excluded.wholesale_price,
      is_available = true,
      updated_at = now();

-- 新埔健保藥局：初心原味維持標準價（隨身包 40、夾鏈袋 211），其餘口味
-- 隨身包 45、夾鏈袋 240。
--
-- 銀杏水蜜桃算在「其餘口味」裡 —— 它不是初心原味，而這是這家專屬的報價，
-- 比先前「新口味一律報 243」的通則更具體。若實際談的是銀杏另計 46 / 243，
-- 把下面兩列銀杏拿掉即可（拿掉就自動回到標準價）。
insert into public.wholesale_channel_items (channel_id, variant_id, wholesale_price)
select c.id, v.variant_id, v.price
from public.wholesale_channels c
cross join (values
  ('8f2e3146-9e23-44a1-ac2f-0fc6d880ca8d'::uuid, 45),   -- 可可 50g
  ('d1c490eb-d8ca-4438-a5f5-2ece23ba02bf'::uuid, 45),   -- 果真草莓 50g
  ('b8242f24-4087-45c1-a1e0-5dfe4705025f'::uuid, 45),   -- 杏仁火龍果 50g
  ('caa4c589-1a88-4e96-992c-2e262e373b84'::uuid, 45),   -- 芝麻藍莓 50g
  ('61aab8e3-b290-49fa-a7ab-a54fbc466aa9'::uuid, 45),   -- 銀杏水蜜桃 50g
  ('20b7ea8b-4ae9-46c9-9def-e9fbb3b1b6b7'::uuid, 240),  -- 可可 300g
  ('867293d6-85c9-4b7a-921c-8bdfbd688d57'::uuid, 240),  -- 果真草莓 300g
  ('8b6bdf71-77bd-411d-a5c8-e92b80aff2c1'::uuid, 240),  -- 杏仁火龍果 300g
  ('32836ed1-ded6-470e-9a8b-25c7da8e9ead'::uuid, 240),  -- 芝麻藍莓 300g
  ('5f54af30-7c9f-4226-beb2-7a4a71dd74a3'::uuid, 240)   -- 銀杏水蜜桃 300g
) as v(variant_id, price)
where c.name = '新埔健保藥局'
on conflict (channel_id, variant_id) do update
  set wholesale_price = excluded.wholesale_price,
      is_available = true,
      updated_at = now();

insert into public.wholesale_channel_items (channel_id, variant_id, wholesale_price, is_available)
select c.id, v.variant_id, null, false
from public.wholesale_channels c
cross join (values
  ('93c40b9e-632a-46b7-b34d-03d228aa2f82'::uuid),  -- 初心原味 300g
  ('20b7ea8b-4ae9-46c9-9def-e9fbb3b1b6b7'::uuid),  -- 可可 300g
  ('867293d6-85c9-4b7a-921c-8bdfbd688d57'::uuid),  -- 果真草莓 300g
  ('8b6bdf71-77bd-411d-a5c8-e92b80aff2c1'::uuid),  -- 杏仁火龍果 300g
  ('32836ed1-ded6-470e-9a8b-25c7da8e9ead'::uuid),  -- 芝麻藍莓 300g
  ('5f54af30-7c9f-4226-beb2-7a4a71dd74a3'::uuid)   -- 銀杏水蜜桃 300g
) as v(variant_id)
where c.name = '原粹蔬食作'
on conflict (channel_id, variant_id) do update
  set is_available = false, updated_at = now();
