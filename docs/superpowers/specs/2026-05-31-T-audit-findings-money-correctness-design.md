# Spec T — Audit 36 件 fix (錢算錯 / 競爭條件 / 效能)

**Date:** 2026-05-31
**Status:** Draft (user approved 全做)
**Touches:** apps/api (~6 files + 2 migrations), apps/web (~4 files), packages/db (2 migrations)
**Scope:** large — ~1200 LOC + 2 migration + ~10 indexes

## Why

audit workflow `wae8b0u13` 5 agents 平行掃整個 checkout + campaign + perf 戰場，發現 **36 個 confirmed bug**。其中 **10 個 P0 直接影響金錢正確性 / 訂單失敗 / 重複扣款**。客人都很精，這些不能拖。

## 重點 P0 (錢算錯 + 重複下單 + 庫存超賣)

| # | 檔案:行 | bug | 影響 |
|---|---|---|---|
| **T1** | `orders.ts:183` | `order_number = "RR" + Date.now()` 沒亂數 suffix → 同 ms 兩請求 UNIQUE 撞 → 500 | 訂單失敗 |
| **T2** | `orders.ts:173` | 沒 `Idempotency-Key` header 支援 → 雙擊送出建 2 筆訂單 + 雙扣庫存 + 雙開金流 | 重複扣款 |
| **T3** | `orders.ts:417-438` | 庫存逐 item 順序扣 (非 atomic) → 多 variant cart 兩個併發 checkout 過 evaluator 後在 RPC 階段超賣 | 庫存超賣 |
| **T4** | `orders.ts:319-345` | coupon `used_count < max_uses` 讀完不 atomic increment → N 個併發都過 | coupon 超用 |
| **T5** | `orders.ts:293` | first_purchase 在 order-insert txn 外評估 → 雙擊兩單都 qualify | 重複給 NT$50 |
| **T6** | `campaigns-evaluator.ts:316` (evalBundle) | 檢查 `totalQty < buyQty`，「買 3 送 1」cart 只有 3 件就送 1 件（實付 2 件） | 送錯免費品 |
| **T7** | `campaigns-evaluator.ts:403-405` (evalSecondHalfPrice) | slice 最便宜 N 個各折 N%；應該每對只折 1 個 | 折太多 |
| **T8** | `checkout/page.tsx:420-427` | auto-shipping effect 把 user 選的 shipping method 強迫改回 "711" | 失去使用者選擇 |
| **T9** | `payment/page.tsx:271` | points debounce deps 漏 `couponApplied/allowCouponStack/pointsAllowed` → coupon 改了 pointsDiscount stale | 多扣點 / 少折扣 |
| **T10** | `payment/page.tsx:367-368` | 確認付款 button 沒 `disabled={pointsApplying}` → 送出時 pointsUsed stale | 點數扣錯 |

## P1 (12 件) — 摘要

| # | 內容 |
|---|---|
| T11 | `isInBirthdayWindow` 跨年 bug：12/31 生日今天 1/1 → bdThisYear 是 365 天後 → 條件失敗。需算 this/next year 兩個 anchor |
| T12 | `isInBirthdayWindow` 時區 bug：UTC parse + 本地 constructor 混用 → 非 Asia/Taipei 伺服器日期偏移 |
| T13 | `evalDiscount` line 223 + `evalBirthdayBonus` line 506 percent 折扣沒 `Math.min(…, sub)` clamp，若 value>100 → 折抵超過 subtotal |
| T14 | `pickBestPerType` line 613-624 只比 `discount_amount`；`points_multiplier`/`freebie`/`free_shipping` 各 type 用第一個（不是最大 multiplier） |
| T15 | `orders.ts` 整路 dollars↔cents 來回 round-trip；`campaign_discount` 寫 dollars，其他欄位寫 cents — schema 不一致；改全 cents |
| T16 | `zero_shipping` 在 refund 路徑會被重新給「免運抵免」 — 持久化 `shipping_zeroed_by_campaign` flag |
| T17 | `points.ts:160` `evaluateAllCampaigns` 每筆 earn 都 re-run 無 cache；`getUserBalance` line 408-419 拉全 row sum 在 JS → 用 SQL SUM RPC；`.in(earnIds)` 過 PG param cap → chunk 1000 |
| T18 | `/campaigns/active` 公開無 cache，每頁載入都跑 → in-memory TTL 30-60s |
| T19 | `orders.ts:583-588` `count: "exact"` orders 表 → 每頁強制全 scan → 改 estimated 或拿掉 |
| T20 | `checkout/page.tsx:244-286` preview useEffect deps 用 `items` array reference → 每次 cart store write 都 new ref → debounce 失效 → serialize 成 stable key |
| T21 | 多處 `createClient() + getSession()` 平行/串行 mount → hoist 一份 module-scope client + `Promise.all` |
| T22 | `payment/page.tsx:192` `grandTotal` 可變負 → 送 gateway 負金額；clamp `Math.max(0, …)` |

## P2 (14 件) — 大量 cleanup + indexes + caching

- categorySlugCache 沒 TTL → 5 min TTL
- evalFirstPurchase 默認 NT$50 / days=0 解釋錯 → fail-closed
- fetchActiveCampaignsForUser 吞 error → log + surface
- 訂單 commit 不重驗 campaign is_active → txn 內 re-check
- Rollback/cleanup 順序執行 → Promise.all
- KOL→coupon FK select join、profile dedup query
- /orders/by-number/:orderNumber/status no cache → 5s TTL
- grantPoints 重 fetch profile → pass through
- refundOrderPoints 兩次 ledger query → `IN ('earn','redeem')`
- localStorage no try/catch → wrap
- persist.rehydrate not awaited → await
- coupon 在 input typing 重置 applied state → 只在 explicit 「移除」清
- 缺 indexes：`orders(order_number) unique` / `orders(user_id, created_at desc)` / `points_ledger(user_id)` / `points_ledger(source, expires_at)` / `campaigns(is_active, starts_at, ends_at)` / `coupons(code) unique` / `kols(slug, is_active)`
- 缺 caching：`loadPointsSettings` / `getMemberDiscountRate` / active campaigns / `tier.rebate_rate`

## Locked decisions
- **錢一律走 cents (integer)**：evaluator API contract 改 cents in / cents out
- **Idempotency-Key 必填** for POST /orders（client 用 crypto.randomUUID）
- **Stock + Coupon atomic** via 新 PostgreSQL functions (SECURITY DEFINER)
- **Order number** = `RR${timestampMs}${4-byte hex random}` + unique constraint catch retry
- **Cache strategy**: in-memory Map with TTL 30-60s for hot reads；server-side only (per Node process，多 instance 接受短期 stale)
- **Birthday window**: 用 `date-fns-tz` 或手算 Asia/Taipei offset；this-year + next-year anchor 兩個都試

## Scope

### IN — Phase 1 DB foundation (migration 0027 + 0028)
- 0027 (shipping settings — Spec S R1)：5 row in app_settings
- 0028 (audit foundation)：
  - `order_idempotency_keys` table (key, user_id|guest_email, order_id, created_at, expires_at)
  - `orders.shipping_zeroed_by_campaign` boolean
  - `orders.first_purchase_applied` boolean + partial unique index `WHERE first_purchase_applied`
  - 7 個 missing indexes
  - 2 個 RPC functions: `atomic_decrement_coupon_usage(coupon_id, max_uses)`、`atomic_deduct_stock(variant_ids[], qtys[])`

### IN — Phase 2 Backend money correctness
- `apps/api/src/lib/campaigns-evaluator.ts`：
  - evalBundle line 316 `< buyQty` → `< buyQty + freeQty`
  - evalSecondHalfPrice line 403-405 改 `for (i = 0; i < pairs; i++) discount += units[i*2]`
  - evalDiscount line 223 + evalBirthdayBonus line 506 加 `Math.min(…, sub)`
  - pickBestPerType 加 per-type comparator
  - isInBirthdayWindow 用 Asia/Taipei + this/next year 兩 anchor
  - evalFirstPurchase config 缺失 → fail-closed
  - categorySlugCache 加 5 min TTL
  - cents 全程整數
- `apps/api/src/routes/orders.ts`：
  - order_number 加 random suffix
  - Idempotency-Key middleware
  - 改 atomic_deduct_stock RPC BEFORE order insert
  - 改 atomic_decrement_coupon_usage RPC
  - first_purchase txn 內 re-check
  - 移除 dollars↔cents 來回轉
  - shipping_zeroed_by_campaign flag persist + refund 路徑檢查
  - `count: "exact"` → `estimated`
  - rollback `Promise.all`
- `apps/api/src/lib/shipping.ts` (Spec S R1 已 plan)
- 加 in-memory cache wrappers：`loadPointsSettings` / `getMemberDiscountRate` / `getActiveCampaigns` / `getTierRebateRate`

### IN — Phase 3 Frontend (Spec S 6 件 + audit P0/P1)
- Spec S R1-R4b 全件 (見 spec S 文件)
- checkout/page.tsx:
  - items deps 改 serialize stable key
  - prefill effect 加完整 deps + `hasPrefilled` guard
  - localStorage wrap try/catch
  - persist.rehydrate await
- payment/page.tsx:
  - 移除 memberDiscount 本地算（改用 preview）
  - points debounce deps 補齊
  - 確認付款 button 加 disabled={pointsApplying}
  - grandTotal clamp `Math.max(0,…)`
  - 確認付款 button 在 pointsApplying 時 disabled
- supabase client hoist 共享

### OUT (這 spec)
- P2 cleanup 全部 (categorySlugCache TTL 除外，因為影響 admin 改名同步) — 之後 Spec U
- `stackable` boolean on coupons + campaigns — 之後 Spec U
- /campaigns/active TTL cache — 之後 Spec U
- localStorage fallback to sessionStorage — 之後 Spec U

## File summary

| 動作 | 路徑 | LOC |
|---|---|---|
| 新 migration | `packages/db/migrations/0027_shipping_settings.sql` | 30 |
| 新 migration | `packages/db/migrations/0028_audit_foundation.sql` (idempotency + indexes + 2 RPCs) | 120 |
| 改 | `apps/api/src/lib/campaigns-evaluator.ts` (8 bugs) | +80 / -30 |
| 改 | `apps/api/src/routes/orders.ts` (order#, idempotency, atomic RPCs, cents, persist flag) | +150 / -60 |
| 新 | `apps/api/src/middleware/idempotency.ts` | 50 |
| 新 | `apps/api/src/lib/shipping.ts` | 30 |
| 新 | `apps/api/src/lib/cache.ts` (TTL wrapper) | 40 |
| 改 | `apps/api/src/lib/points.ts` (cache + Promise.all + cents) | +40 / -30 |
| 改 | `apps/web/src/app/checkout/page.tsx` (Spec S + audit P0/P1) | +60 / -40 |
| 改 | `apps/web/src/app/checkout/payment/page.tsx` (P0 deps + clamp + disabled) | +30 / -20 |
| 新 | `apps/web/src/lib/api-url.ts` + `lib/order-status.ts` + `lib/shipping.ts` | 75 |
| 改 | 4 my-account/admin status label callsites | +4 / -40 |
| 改 | 3 customer-email hardcode (contact/faq/terms) | +6 / -6 |
| 改 | `apps/web/src/app/admin/settings/page.tsx` (shipping section) | +25 |
| 改 | `apps/web/src/components/checkout/InvoiceSelector.tsx` (taxId regex) | +10 |

預估 ~750 LOC code + 150 LOC SQL / 2 migration / 7 indexes / 2 RPC functions

## Validation

- ✅ tsc web + api 雙綠
- Idempotency: 同 Idempotency-Key 連送 2 次 → 第二次回 cached order
- order_number collision: parallel 100 orders → 全部唯一
- 庫存 race: 雙併發超賣 → 第二筆 RPC reject
- coupon: 5 個併發領 max_uses=3 coupon → 只 3 成功
- evalBundle: cart 3 件「買3送1」→ notApplied
- evalSecondHalfPrice: 4 個 [10,20,30,40] units 2 pair → 折 10+30 (40)，不是 10+20 (30)
- 生日跨年: birthday=12/31, today=1/1 → applied
- preview API contract cents: 所有 number 都是整數 cents
- checkout shipping 切換不再失去 user 選擇

## Risks

- **migration 0028 加 partial unique index 在現有 orders 表**：若已有重複 first_purchase_applied=true 會 fail；先 normalize 再加（migration 內含 cleanup step）
- **Idempotency-Key**：舊版前端 client 還沒送 header → backend 仍允許缺 key（warning log）；過渡期一週後改 enforce
- **atomic RPC 順序**：先扣 stock 再扣 coupon —— stock 失敗就 reject 不扣 coupon；coupon 失敗就 release stock (rollback RPC)
- **cents-everywhere**：legacy orders 既有資料 `campaign_discount` 可能 dollars；migration 內 detect + migrate；前端 my-account/orders 顯示也要對齊
- **Cache TTL 30-60s**：admin 改設定後可能 1 分鐘內前台看到舊值；可接受
