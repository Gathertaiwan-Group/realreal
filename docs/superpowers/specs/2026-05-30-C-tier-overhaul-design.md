# Spec C — 會員等級系統大改造（權益 decoupling + 時效性 + 自動降級）

**Date:** 2026-05-30
**Status:** Draft → pending user review (3 of 4 in marketing/tier overhaul batch)
**Touches:** apps/api (2 lib modified, 1 new worker, 1 route modified), apps/web (2 admin pages modified, 1 customer page modified), packages/db (1 migration)
**Scope:** large — ~800 LOC

## Why

3 個問題綁在同一個系統：

1. **權益 5-checkbox 是 dead UI**。`apps/web/src/app/admin/marketing/tiers/page.tsx:27` 的 `BENEFIT_OPTIONS = [free_shipping / birthday_coupon / early_access / points_multiplier / vip_support]` 整個 codebase 沒有任何地方真的依此打折扣或變運費 (`grep tier.*benefits` 只有升等 email template 把它顯示成 bullets)。Admin 勾不勾沒差，純裝飾。

2. **無等級時效性**。`user_profiles.membership_tier_id` 一旦設了永久有效，沒 expires_at。即使顧客升上同心之友後 2 年完全沒消費，仍享 9 折。但截圖三第三張顯示業務上 tier 有效期是「升等日起 1 / 2 年 + 半年內須累積 3500 才續約」，現在程式碼完全沒實作。

3. **Admin tier 編輯器看不到該等級實際有什麼活動**。會員看截圖三知道「金卡有生日 9 折」，但 admin 在 tier 頁完全看不到 — 因為生日活動是 `campaigns` 表的記錄、跟 tier 沒 view 連動。

## Locked decisions
- 等級到期語意 = **A**：達標 (`tier_period_spend >= requalify_amount`) → 續約 N 個月；未達 → 降級到下一等級
- 達標 window = `requalify_window_months`（圖三的「3500/半年」= 6）
- 等級權益 5-checkbox **全部砍**，替換成自由文字 `perks JSONB` (`["常態 95 折", "公益存款 2.3%", ...]`) + 該等級自動連動的 active campaigns read-only list
- 升等 email 改讀 `perks` (free text) 而非 `benefits` keys

## Scope

### IN
1. Migration 0021 — membership_tiers + user_profiles schema 加新欄位 + backfill
2. Tier 編輯器 UI 大改：砍 checkbox、加 tagline / perks / validity / requalify 欄、加自動連動 campaigns read-only 區塊
3. `lib/tier.ts upgradeTierIfNeeded` 改寫：set tier_started_at + tier_expires_at + reset tier_period_spend
4. `lib/tier.ts` 新 `incrementPeriodSpend(userId, amount)` — 每次付款後呼叫加上 order_total
5. 新 worker `workers/tier-expire.ts` — daily 04:00 Asia/Taipei cron，找過期 user、達標續約 / 未達降級 + 寄 email + 寫 audit
6. 升等 / 續約 / 降級 3 種 email templates
7. `enqueue-post-payment.ts` 加呼叫 `incrementPeriodSpend(userId, orderTotal)`
8. Customer detail page (admin) 等級狀態 card 顯示：升等日 / 期滿日 / 本期累積 / 達標 needed / 距期滿天數（< 30 紅、< 90 橘）
9. `/my-account` 顧客自己看：等級期滿時間 + 達標進度
10. `routes/tiers.ts` 加 `GET /tiers/:id/linked-campaigns` — 給 admin tier 編輯器用

### OUT
- 提早續約優惠（「升等日後 60 天內再 N 元送 N 個月延長」）
- 降級緩衝期（過期當下就降，不給 7 天 grace）
- 跨等級 promo (e.g., 「初心 + 知心同時享生日 9 折」)
- 等級徽章 / icon （現有的星星圖已足，不換）
- 手動凍結帳號自動算降級 — 凍結 = role=disabled，不在 tier 流程

## Design

### Section 1 — Migration 0021

`packages/db/migrations/0021_tier_validity_and_perks.sql`:
```sql
-- membership_tiers: 自由文字權益 + 有效期 + 達標規則
ALTER TABLE membership_tiers
  ADD COLUMN IF NOT EXISTS tagline TEXT,                       -- 「起於一念善意，從心出發」
  ADD COLUMN IF NOT EXISTS perks JSONB NOT NULL DEFAULT '[]',  -- ["常態 95 折", ...]
  ADD COLUMN IF NOT EXISTS validity_months INT NOT NULL DEFAULT 0,         -- 0 = 永久
  ADD COLUMN IF NOT EXISTS requalify_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requalify_window_months INT NOT NULL DEFAULT 6;

-- user_profiles: 等級時效 tracking
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS tier_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tier_expires_at TIMESTAMPTZ,        -- NULL = 永久
  ADD COLUMN IF NOT EXISTS tier_period_spend NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill 既有 3 個 tier 的 validity rule per 截圖三:
UPDATE membership_tiers SET validity_months = 0, requalify_amount = 0
  WHERE name = '初心之友';
UPDATE membership_tiers SET validity_months = 12, requalify_amount = 3500, requalify_window_months = 6,
  perks = '["常態 95 折", "消費金額 3.3% 累積為公益存款", "生日當月消費 9 折，公益存款雙倍累積", "線上講座與課程邀請"]'::jsonb,
  tagline = '彼此理解，真誠相遇'
  WHERE name = '知心之友';
UPDATE membership_tiers SET validity_months = 24, requalify_amount = 12000, requalify_window_months = 12,
  perks = '["常態 9 折", "消費金額 3.3% 累積為公益存款", "生日當月消費公益存款雙倍累積", "專屬生日禮", "線上與實體活動邀請"]'::jsonb,
  tagline = '同行於善，美好成真'
  WHERE name = '同心之友';
UPDATE membership_tiers SET validity_months = 0,
  perks = '["常態 95 折", "消費金額 2.3% 累積為公益存款", "生日禮券，生日當月消費公益存款雙倍累積"]'::jsonb,
  tagline = '起於一念善意，從心出發'
  WHERE name = '初心之友';

-- Backfill 既有 user_profiles 的 tier_started_at = updated_at (粗估)、tier_expires_at = NULL (待 cron 首次補)
UPDATE user_profiles SET tier_started_at = COALESCE(created_at, NOW())
  WHERE membership_tier_id IS NOT NULL AND tier_started_at IS NULL;
-- tier_expires_at 一律 NULL，daily cron 第一次 run 會根據 tier.validity_months 補上正確值
```

### Section 2 — lib/tier.ts 改寫

```ts
// 1. 升等時 set expires_at
export async function upgradeTierIfNeeded(userId, newTotalSpend) {
  // 既有邏輯找 eligible tier
  if (eligible.id !== currentTierId) {
    const newExpiresAt = eligible.validity_months > 0
      ? addMonths(now, eligible.validity_months)
      : null
    await supabase.from("user_profiles").update({
      membership_tier_id: eligible.id,
      tier_started_at: now,
      tier_expires_at: newExpiresAt,
      tier_period_spend: 0,
      total_spend: newTotalSpend,
    }).eq("user_id", userId)
    
    // tier_upgrade_bonus 觸發 (既有邏輯)
    // 升等 email 寄送 (改用 perks 而非 benefits)
  }
}

// 2. 每次付款後累計 period spend
export async function incrementPeriodSpend(userId, amount) {
  await supabase.rpc("increment_tier_period_spend", { user_id: userId, amount })
  // OR raw SQL update:
  // UPDATE user_profiles SET tier_period_spend = tier_period_spend + amount WHERE user_id = ?
}
```

`enqueue-post-payment.ts` 在 grantPoints / redeemPoints 同處呼叫 `incrementPeriodSpend(userId, orderTotal)`。

### Section 3 — 新 worker `workers/tier-expire.ts`

```ts
import { Queue, Worker } from "bullmq"
import { Redis } from "ioredis"

export const tierExpireQueue = new Queue("tier-expire", { connection })
export const tierExpireWorker = new Worker("tier-expire", async () => {
  const now = new Date()
  const { data: expired } = await supabase
    .from("user_profiles")
    .select("user_id, membership_tier_id, tier_period_spend, membership_tiers(id, name, requalify_amount, requalify_window_months, validity_months, min_spend)")
    .lt("tier_expires_at", now.toISOString())
  
  for (const u of expired ?? []) {
    const tier = u.membership_tiers as any
    if (Number(u.tier_period_spend) >= Number(tier.requalify_amount)) {
      // 達標續約
      const newExpiresAt = tier.validity_months > 0
        ? addMonths(now, tier.validity_months)
        : null
      await supabase.from("user_profiles").update({
        tier_started_at: now.toISOString(),
        tier_expires_at: newExpiresAt,
        tier_period_spend: 0,
      }).eq("user_id", u.user_id)
      await enqueueEmail("tier-renewed", { userId: u.user_id, tierName: tier.name })
    } else {
      // 未達 → 降級到下一級 (min_spend 最高但 < 當前 tier.min_spend 的)
      const { data: lowerTier } = await supabase.from("membership_tiers")
        .select("*").lt("min_spend", tier.min_spend).order("min_spend", { ascending: false }).limit(1).single()
      if (!lowerTier) continue  // 已是最低，無法再降
      const newExpiresAt = lowerTier.validity_months > 0
        ? addMonths(now, lowerTier.validity_months)
        : null
      await supabase.from("user_profiles").update({
        membership_tier_id: lowerTier.id,
        tier_started_at: now.toISOString(),
        tier_expires_at: newExpiresAt,
        tier_period_spend: 0,
      }).eq("user_id", u.user_id)
      await enqueueEmail("tier-downgraded", { userId: u.user_id, fromTier: tier.name, toTier: lowerTier.name })
    }
  }
})
```

加進 `apps/api/src/worker.ts`:
```ts
import { tierExpireQueue, tierExpireWorker } from "./workers/tier-expire"
tierExpireQueue.upsertJobScheduler("daily-tier-expire", { pattern: "0 4 * * *", tz: "Asia/Taipei" }, { name: "expire", data: {} })
```

### Section 4 — Email templates 3 種

`apps/api/src/emails/`:
- `TierUpgrade.ts` (改寫，讀 perks 不讀 benefits)
- `TierRenewed.ts` (新) — 「恭喜續約 X 等級，期滿日 ____」
- `TierDowngraded.ts` (新) — 「期內未累積至 ____，已調整為 X 等級，未來繼續累積至 ____ 即可升回」

`workers/email-sender.ts` 加 2 個新 template handler。

### Section 5 — Tier admin UI 大改 (`apps/web/src/app/admin/marketing/tiers/page.tsx`)

**砍**：
- `BENEFIT_OPTIONS` 常數（line 27-34）
- 表格「其他權益」column（5 個 checkbox）
- `benefits: BenefitKey[]` type
- `<BenefitChips>` 元件（line 270+）

**加**：
- 表格新 columns：`Tagline` (TEXT inline edit) / `有效月` (INT, 0=永久) / `達標金額` (NUMERIC) / `達標窗口月` (INT)
- 每 row 下方可摺疊「自動連動活動」section：
  - 抓 GET `/tiers/:id/linked-campaigns` (新 endpoint，內部查 `campaigns WHERE tier_id = this.id AND is_active`)
  - 顯示活動名稱 + type + 期間，read-only，連結到 /admin/campaigns/:id
  - 旁註：「這些活動為自動連動，刪除或停用請至行銷活動 tab」
- `perks` 編輯：moved to row expand，用簡單 textarea 一行一條目（前端 split `\n`，存 JSON array）

### Section 6 — Customer detail (admin) 等級狀態 card

`apps/web/src/app/admin/customers/[id]/_client.tsx` 既有「會員狀態」card 增加：
- 升等日: `tier_started_at` (format date)
- 期滿日: `tier_expires_at` ?? "永久"
- 本期累積: `tier_period_spend` / `requalify_amount` (e.g., "NT$ 1,800 / NT$ 3,500")
- 距期滿: N 天 (color: < 30 red, < 90 amber, else gray)

API 端 `GET /admin/customers/:id` 已 fetch membership_tier 細節 (admin-customers.ts:36)，僅需 select 多帶 `tier_started_at, tier_expires_at, tier_period_spend, membership_tiers.requalify_amount, requalify_window_months`。

### Section 7 — /my-account 顧客自己看

`apps/web/src/app/my-account/page.tsx` 既有等級 badge 旁邊增加：
- 「會員效期至 YYYY/MM/DD」（若 expires_at NULL：「永久會員」）
- Progress bar：本期累積 / 達標 needed
- 警語：「再消費 NT$ X 即可續約 N 個月」（< 30 days 顯示）

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0021_tier_validity_and_perks.sql` |
| 改 | `apps/api/src/lib/tier.ts` (upgradeTierIfNeeded + 新 incrementPeriodSpend) |
| 改 | `apps/api/src/lib/enqueue-post-payment.ts` (呼叫 incrementPeriodSpend) |
| 新 | `apps/api/src/workers/tier-expire.ts` |
| 改 | `apps/api/src/worker.ts` (註冊 daily 04:00 cron) |
| 改 | `apps/api/src/routes/tiers.ts` (新 GET /:id/linked-campaigns) |
| 改 | `apps/api/src/routes/admin-customers.ts` (select 加新欄) |
| 改 | `apps/api/src/emails/TierUpgrade.ts` (讀 perks) |
| 新 | `apps/api/src/emails/TierRenewed.ts` |
| 新 | `apps/api/src/emails/TierDowngraded.ts` |
| 改 | `apps/api/src/workers/email-sender.ts` (2 new templates) |
| 改 | `apps/web/src/app/admin/marketing/tiers/page.tsx` (大改 — 砍 checkbox + 加新欄 + linked campaigns 區塊) |
| 改 | `apps/web/src/app/admin/customers/[id]/_client.tsx` (會員狀態 card 加 4 lines) |
| 改 | `apps/web/src/app/my-account/page.tsx` (顧客自己看效期 + progress) |

預估 ~800 LOC 新增 / ~300 LOC 修改 / 1 migration

## Validation

1. `npm test` / `tsc` / `next build` 全綠
2. Migration 0021 套用，3 個既有 tier 的 `perks` / `tagline` / `validity_months` / `requalify_amount` backfill 正確
3. 既有 53 個 user_profiles 的 `tier_started_at` 都填了（用 created_at fallback）
4. 模擬：knot 將某 user 改 tier_expires_at = 昨天 + tier_period_spend = 0 → 跑 worker → 應降級到下一級 + 寄 downgrade email
5. 模擬：某 user tier_period_spend = 10000 (達標) + expires_at 過期 → 應續約 + 寄 renewed email
6. 顧客 my-account 顯示「會員效期至 YYYY/MM/DD」+ progress bar
7. admin tier 編輯器看不到 5-checkbox，看得到「自動連動活動」list（生日 campaigns 應顯示在對應 tier）

## Known caveats

- Cron 一次跑全表 user_profiles 過期檢查，現階段 53 人沒問題；資料增大後考慮按 user_id 分批 cursor。
- 「降級到下一級」邏輯：找 `min_spend < current.min_spend` 最高的；若初心 (min_spend=0) 過期不會降（已最低）。spec 不強制初心也有 validity_months，所以初心 validity_months=0 永遠不會走到這。
- `incrementPeriodSpend` 用 raw SQL UPDATE 而非 RPC 避免增 Postgres function；race condition 可接受（兩個並發 update 會最後一個贏，丟失極少；高並發場景才需 RPC `... SET tier_period_spend = tier_period_spend + ?`）。
- 既有 charity_savings 系統不動（仍跑），points_ledger 才是 SoT；tier 系統與 points 完全獨立。
- Tier 名稱被 admin 改了 (e.g., 「初心之友」改成「Bronze」)，backfill SQL 用 WHERE name=... 對不上，須手動更新或重跑 backfill。本案以現有名為準。
