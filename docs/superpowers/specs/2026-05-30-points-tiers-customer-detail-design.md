# 公益點數系統 + 行銷頁等級 tab + 客戶 detail 頁

**Date:** 2026-05-30
**Status:** Draft → pending user review
**Touches:** apps/api (3 new routes + 1 worker + 2 lib + 2 改), apps/web (3 new pages + 4 改), packages/db (1 migration)
**Spec scope:** 3 sub-features tightly coupled — points lifecycle, tier admin consolidation into 行銷 tab, customer detail page.

## Why

目前後台的痛點：
1. **公益點數只能累計、無法折抵** — `user_profiles.charity_savings` 累計沒問題（`incrementSpendAndUpgrade` 每筆訂單依 tier `benefits.rebate_rate` 加值），但顧客結帳無處使用、admin 無 UI 調整、無 ledger audit。
2. **會員等級管理分散** — tier CRUD 在 `/admin/membership` 獨立頁；行銷頁（`/admin/marketing` = campaigns + coupons tabs）看不到 tier。`rebate_rate` 藏在 `benefits` JSON 內 admin UI 不直觀。
3. **客戶管理頁是 flat list 不能點進去** — `/admin/customers/page.tsx` 只顯示 name/phone/tier/role/spend/joined，53 位客戶要看任一個的消費紀錄、點數狀態都得跳資料庫。

業務目標：admin 一頁看完所有客戶細節 + admin 自助設定點數規則與等級回饋 + 顧客結帳能用點折抵。

## Scope

### IN

1. **`points_ledger` 表 + 5 個生命週期事件** — earn / redeem / expire / refund / manual_adjust。balance = `SUM(delta) WHERE user_id=X`。
2. **`app_settings.points.*`** — 7 個 runtime-configurable 規則（換算比、折抵上下限、coupon 疊加、運費/特價套用、過期天數）。
3. **`membership_tiers.rebate_rate` 拉到頂層 column** — 從現有 `benefits.rebate_rate` JSON 搬出來（保留其他 checkbox 權益在 JSON）。
4. **行銷頁加 2 個 tab** — 「會員等級」「點數規則」。
5. **`/admin/customers/[id]/`** 全新 single-page，5 區塊 layout（Hero / 會員狀態 / 最近消費 / 點數紀錄 / Admin 操作）。
6. **客戶列表 row 可點 + 加「點數餘額」欄**。
7. **結帳頁加折抵 UI**、**`/my-account` 加點數 card**。
8. **`points-expire` daily cron worker**。
9. **取消訂單 orchestrator** 新增 step「points-refund」。
10. **既有 `/admin/membership` 整頁砍掉** → redirect 到 `/admin/marketing?tab=tiers`。

### OUT

- **點數轉贈** — 親友互轉、生日贈送。
- **生日加碼 / 促銷類點數** — `source=promo` ledger 欄已預留但本案不寫前端規則 UI。
- **二維碼線下兌點** — 純線上 e-comm。
- **`會員分析` 頁** — 現有 `/admin/membership` tab 2/3「會員分析」「等級權益說明」整頁砍。日後若需要 dashboard 另案。

## Design

### Section 1 — Data model

#### 新表 `points_ledger`

```sql
CREATE TABLE points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta INT NOT NULL,                         -- 正 = 入帳，負 = 扣帳
  source TEXT NOT NULL CHECK (source IN (
    'earn',           -- 消費回饋（依 tier rebate_rate）
    'redeem',         -- 結帳折抵
    'expire',         -- 過期對沖（負值）
    'refund',         -- 退款返還（雙向：退回 redeem 用掉的、扣回 earn 加過的）
    'manual_adjust',  -- admin 手動 +/-（必填 note）
    'promo'           -- 預留（生日加碼 / 活動贈點）
  )),
  source_ref_id TEXT,                         -- order_id / refund_id / promo_id / null
  note TEXT,                                  -- manual_adjust 必填
  expires_at TIMESTAMPTZ,                     -- 僅 earn 行有意義；其他 NULL
  actor_id UUID,                              -- 手動調整時的 admin user_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_points_ledger_user ON points_ledger(user_id, created_at DESC);
CREATE INDEX idx_points_ledger_expires ON points_ledger(expires_at)
  WHERE source = 'earn' AND expires_at IS NOT NULL;
```

#### `orders` 加欄
```sql
ALTER TABLE orders ADD COLUMN points_used INT NOT NULL DEFAULT 0;
```

#### `membership_tiers` 改造
```sql
ALTER TABLE membership_tiers
  ADD COLUMN rebate_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

-- Backfill 從 benefits JSON 取出 rebate_rate（既有資料可能存 2.3 / 3.3 之類）
UPDATE membership_tiers
SET rebate_rate = COALESCE((benefits->>'rebate_rate')::numeric, 0)
WHERE benefits ? 'rebate_rate';

-- benefits JSON 移除 rebate_rate 鍵（保留其他 checkbox）
UPDATE membership_tiers
SET benefits = benefits - 'rebate_rate';
```

#### `app_settings.points` （沿用既有 settings 系統）
Seed 預設值：
```
points.ratio = "1"                  # 1 點 = NT$ 1
points.min_redeem = "0"
points.max_redeem_pct = "100"
points.allow_coupon_stack = "true"
points.apply_to_shipping = "false"
points.apply_to_sale = "true"
points.expire_days = "365"          # 0 = 永不過期
```

#### Balance — view + lib，兩個都用

```sql
-- view: 客戶列表 / admin dashboard 多人查詢時 join 用
CREATE OR REPLACE VIEW v_user_points_balance AS
SELECT user_id, COALESCE(SUM(delta), 0)::INT AS balance
FROM points_ledger GROUP BY user_id;
```

```ts
// lib: 單一 user 查 + checkout 即時算
export async function getUserBalance(userId: string): Promise<number>
```

決定原則：列表 / 一次撈多人 → view；單一 user / 寫操作前讀 → lib（這支函式在 transaction 內也能用）。

### Section 2 — Points 生命週期

`apps/api/src/lib/points.ts` 5 個 export：

```ts
// 1. Earn — 訂單付款成功時呼叫，依 tier.rebate_rate 算
async function grantPoints(orderId, userId, orderAmount, tierId): Promise<number>

// 2. Redeem — 訂單付款成功時呼叫，從 orders.points_used 讀
async function redeemPoints(orderId, userId, pointsUsed): Promise<void>

// 3. Expire — daily cron
async function expirePoints(now: Date): Promise<{ rows: number; total: number }>

// 4. Refund — 取消訂單 cancel orchestrator 呼叫
async function refundOrderPoints(orderId, userId): Promise<{ earned_reverted: number; redeemed_returned: number }>

// 5. Manual adjust — admin only
async function adjustPoints(userId, delta, note, actorId): Promise<void>

// Pure calc 給 checkout API 用
function calcPointsDiscount(cart, requestedPoints, settings): { discount: number; allowed: boolean; reason?: string }
```

**Refund 對稱規則：**
- 退所有 earn rows 帶 `source_ref_id = order_id` 的金額 → 寫 `-N source=refund source_ref_id=order_id note="earn revert"`
- 退所有 redeem rows 帶 `source_ref_id = order_id` 的金額 → 寫 `+N source=refund source_ref_id=order_id note="redeem return"`
- 即使顧客已用掉那筆點數買別的東西仍照退（餘額可能變負，但 ledger 永遠對得起來）

**Expire 邏輯：**
- 找 `source='earn' AND expires_at < NOW() AND NOT EXISTS (matching expire row)`
- 對每筆 earn 寫 `-delta source=expire source_ref_id=earn_row_id`
- 過期日期 NULL 的（settings.expire_days=0）跳過

**Apply-points calc：**
```ts
function calcPointsDiscount(cart, requested, settings) {
  const ratio = Number(settings.ratio)
  const minRedeem = Number(settings.min_redeem)
  const maxPct = Number(settings.max_redeem_pct)
  
  if (requested < minRedeem) return { allowed: false, reason: `最少 ${minRedeem} 點` }
  
  const eligible = (settings.apply_to_shipping ? cart.total : cart.subtotal)
                 - (settings.apply_to_sale ? 0 : cart.sale_item_total)
  const cap = Math.floor(eligible * maxPct / 100)
  const maxPoints = Math.floor(cap / ratio)
  
  if (requested > maxPoints) return { allowed: false, reason: `最多 ${maxPoints} 點` }
  
  return { allowed: true, discount: requested * ratio }
}
```

### Section 3 — 行銷頁 4-tab 結構

`apps/web/src/app/admin/marketing/` 改成資料夾，下含：
```
layout.tsx          ← 4 tabs (AdminTabs 沿用)
campaigns/page.tsx  ← 從 /admin/campaigns 搬進來
coupons/page.tsx    ← 從 /admin/coupons 搬進來
tiers/page.tsx      ← 新（取代 /admin/membership tab1）
points/page.tsx     ← 新
```

或為了不動既有路由：保留 `/admin/campaigns` `/admin/coupons` 路徑，新增 `/admin/marketing/tiers`、`/admin/marketing/points`，4 個共用同一 `AdminTabs` 設定 `[{href:/admin/campaigns}, {/admin/coupons}, {/admin/marketing/tiers}, {/admin/marketing/points}]`。這方案 url 不變、改動小，**採用這方案**。

**會員等級 tab UI** — 一個 table：
```
| 名稱       | 升等門檻NT$ | 自動折扣% | 點數回饋% | 其他權益          | 操作      |
| 初心之友   | 0          | 0%       | 1%       | □免運 ☑生日券    | [刪除]   |
| 知心之友   | 3000       | 5%       | 2%       | ☑免運 ☑生日券    | [刪除]   |
| 同心之友   | 10000      | 10%      | 3%       | ☑免運 ☑生日券 ☑早鳥 | [刪除]   |
[+ 新增等級]
```
所有欄位 inline editable，按 Enter 或失焦自動 PATCH。新增 → 浮一個 row、填完 POST。

**點數規則 tab UI** — 一張 form + 即時統計：
```
┌─ 點數規則 ─────────────────────────────────────┐
│  換算    [1     ] 點 = NT$ [1   ]                │
│  最少折抵 [0     ] 點                            │
│  單筆上限 [100   ] %                             │
│  ☑ 可與 coupon 疊加                             │
│  □ 可折抵運費                                    │
│  ☑ 可折抵特價商品                                │
│  過期    [365   ] 天 (0 = 永不過期)              │
│  [儲存]                                          │
└──────────────────────────────────────────────────┘
┌─ 目前狀態（read-only） ─────────────────────────┐
│  有點數的會員：38 位                              │
│  流通中總點數：54,200 點                          │
│  本月即將過期：3,200 點 / 12 位會員              │
└──────────────────────────────────────────────────┘
```

### Section 4 — 客戶 detail 頁

`apps/web/src/app/admin/customers/[id]/page.tsx`（server）+ `_client.tsx`（client）。

#### Server fetch
一次 join：
```ts
const { data } = await supabase
  .from("user_profiles")
  .select(`
    user_id, display_name, phone, birthday, role, created_at, total_spend,
    membership_tiers(id, name, min_spend, rebate_rate),
    auth_user:auth.users(email, last_sign_in_at)
  `)
  .eq("user_id", id)
  .single()

// 額外：
// - balance: SELECT SUM(delta) FROM points_ledger WHERE user_id=id
// - expiring_soon: SUM(delta) WHERE source='earn' AND expires_at BETWEEN NOW AND NOW+30d AND no matching expire row
// - recent orders: SELECT 10 latest orders
// - ledger: SELECT 50 latest ledger rows (paginate later)
// - next_tier: 從 membership_tiers 找下一個 min_spend > total_spend 的
```

#### 5 區塊 layout

```
[Hero card]
  顯示 name, email, phone, joined date, role badge
  右上: [編輯資料] [發送密碼重設信]

[會員狀態 card]
  目前等級 [tier badge]   累計消費 NT$ X
  Progress bar: ▓▓▓▓░░ 還差 NT$ Y 升「Z 等級」（next_tier 算出來；若已最高等級顯示「已達最高等級」）
  公益點數餘額: X 點
  🟡 30 天內過期: X 點（橘色字；若 0 不顯示）

[最近消費 card]
  table: 訂單編號(可點→/admin/orders/[id]) | 日期 | 金額 | 狀態(display badge) | 點數+/-
  下方 link: 「看全部 N 筆訂單 →」 跳 /admin/orders?user=X

[點數紀錄 card]
  table: 時間 | 變動 | 來源 | 備註 | 過期 (僅 earn 顯示)
  顯示 50 筆，下方 paginate

[Admin 操作 card]
  [手動加扣點 +/-] 開 modal: 數值(±整數) + 原因(必填) + 確認 → POST /admin/customers/:id/points/adjust
  [更換等級] dropdown 選新 tier → PATCH /admin/customers/:id/tier { tier_id }
  [發送密碼重設信] → POST /admin/customers/:id/send-reset-email
  [停用帳號] (危險按鈕 紅色, 二次確認) → PATCH /admin/customers/:id { disabled: true }
```

#### 客戶列表頁改動 (`/admin/customers/page.tsx`)
1. `<tr>` 加 `cursor-pointer hover:bg-...`、wrap 整 row 在 `<Link href={/admin/customers/${id}}>` 或 `onClick={() => router.push(...)}`
2. 新增「點數餘額」欄（從 v_user_points_balance view JOIN 取）放在「累計消費」右側

### Section 5 — 顧客端 UI

**`/checkout/payment/page.tsx`** 加區塊：
```
┌─ 公益點折抵 ─────────────────────────────────────┐
│  你目前有 1,250 點（NT$ 1,250 價值）              │
│  使用點數 [____] 點   [全部使用]                  │
│   ↑ 即時打 /api/cart/apply-points 算扣多少        │
│  已折抵 -NT$ 800                                  │
└──────────────────────────────────────────────────┘
```
下單時把 `points_used` 帶進 order payload。

**`/my-account/page.tsx`** 加 card：
```
┌─ 公益點數 ───────────────────────────────────────┐
│  目前餘額: 1,250 點 (= NT$ 1,250)                │
│  🟡 30 天內過期: 200 點                          │
│  [看點數歷史 →] expand 顯示 ledger 最近 20 筆     │
└──────────────────────────────────────────────────┘
```

### Section 6 — Worker / cron

`apps/api/src/workers/points-expire.ts`：
- BullMQ queue `points-expire`
- Daily scheduler (repeatable job, every day 03:00 Asia/Taipei)
- handler 呼叫 `expirePoints(now)` 寫批次 -N expire ledger row

加進 `apps/api/src/worker.ts`：
```ts
import { pointsExpireWorker, pointsExpireQueue } from "./workers/points-expire"
await pointsExpireQueue.upsertJobScheduler("daily-points-expire", { pattern: "0 3 * * *", tz: "Asia/Taipei" }, { name: "expire" })
```

### Section 7 — Cancel orchestrator 銜接

`apps/api/src/routes/admin-orders.ts` 的 `POST /:id/cancel`（spec 2026-05-30 order-state）已有四步：作廢→取消物流→退款→翻 status。

**追加第 5 步 `points_refund`**：
```ts
try {
  const r = await refundOrderPoints(orderId, order.user_id)
  actions.points_refund = { ok: true, message: `返還 ${r.redeemed_returned} 點、扣除 ${r.earned_reverted} 點回饋` }
} catch (e) {
  actions.points_refund = { ok: false, message: e.message }
}
```

UI 顯示在 Admin 取消結果 modal 第 5 行。

### Section 8 — Testing

- `lib/points.test.ts` — earn/redeem/refund/expire/adjust 各 happy + edge
- `routes/__tests__/points.test.ts` — apply-points calc cases (min/max/stack)
- `routes/__tests__/admin-customers.test.ts` — detail + adjust + tier change
- 取消測試補上 points_refund step

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0017_points_ledger_and_tier_rebate.sql` |
| 新 | `apps/api/src/lib/points.ts` |
| 新 | `apps/api/src/routes/points.ts` (apply-points, balance, ledger 公開 endpoint) |
| 新 | `apps/api/src/routes/admin-customers.ts` (detail, ledger, adjust, tier change, send-reset, disable) |
| 新 | `apps/api/src/workers/points-expire.ts` |
| 改 | `apps/api/src/worker.ts` (註冊 daily cron) |
| 改 | `apps/api/src/lib/tier.ts` (rebate_rate 從 column 讀、不再 from JSON) |
| 改 | `apps/api/src/lib/enqueue-post-payment.ts` (加 points-grant + points-redeem) |
| 改 | `apps/api/src/routes/admin-orders.ts` cancel orchestrator (加 step 5 points_refund) |
| 改 | `apps/api/src/lib/settings.ts` (加 points.* allowed keys + section seed) |
| 新 | `apps/web/src/app/admin/customers/[id]/page.tsx` + `_client.tsx` |
| 改 | `apps/web/src/app/admin/customers/page.tsx` (row clickable + 點數欄) |
| 新 | `apps/web/src/app/admin/marketing/tiers/page.tsx` |
| 新 | `apps/web/src/app/admin/marketing/points/page.tsx` |
| 改 | `apps/web/src/app/admin/campaigns/page.tsx` + `coupons/page.tsx` (AdminTabs 加 2 個 href) |
| 刪 | `apps/web/src/app/admin/membership/` (改成 redirect stub → /admin/marketing/tiers) |
| 改 | `apps/web/src/app/checkout/payment/page.tsx` (加折抵 UI) |
| 改 | `apps/web/src/app/my-account/page.tsx` (加點數 card) |
| 改 | `apps/web/src/app/admin/layout.tsx` 側邊欄 nav (確認「行銷」、「客戶」連結 still 通) |
| 測 | `apps/api/test/points.test.ts` + `admin-customers.test.ts` + cancel 補 points step |

預估：~1500 lines new / ~300 lines modified。

## Validation

1. `npm test` apps/api 全綠（除已標記的 pre-existing 18 個 unrelated failures）
2. `npm run build` apps/api / `next build` apps/web 雙綠
3. migration 0017 套到 Supabase（user 手動貼 SQL editor，同 0016 模式）
4. Railway api+worker / Vercel web push 觸發 auto deploy
5. End-to-end smoke：
   - admin 在 /admin/marketing/tiers 改某等級 rebate_rate 從 1% 到 5%
   - 模擬該等級顧客付款 NT$1000 → ledger 應寫 +50 earn
   - admin 進 /admin/customers/[id] 看到 +50 紀錄、餘額正確
   - 顧客結帳用 30 點 → discount NT$30、order.points_used=30
   - admin 在 customer detail 手動 -10 點 with note → ledger 寫 -10 manual_adjust
   - cron 觸發 → 過期 earn 的對沖 row 寫入

## Known caveats

- `points_ledger` 可能因 refund 順序變負，UI 顯示時 `Math.max(0, balance)` 防呆，但 ledger 真實值保留以供 audit。
- `expirePoints` 一次跑全表，初期資料量小 OK；資料增大後可加 user_id 分批 cursor。
- 點數規則的 `apply_to_shipping=true` 路徑與 `apply_to_sale=false` 路徑要在 checkout 端正確扣不該折的部分 — `calcPointsDiscount` 內已有但需要 cart 帶 `subtotal / shipping / sale_item_total` 三欄。
- 手動調整點數無 expire 概念 — `source=manual_adjust` 的 row `expires_at=NULL`，永久（即使全站 expire_days 設成 365）。這是 admin 的特權。
- 等級被刪除若有顧客指向 → API 阻擋（既有 /admin/membership 應已有此 guard，本案沿用）。
