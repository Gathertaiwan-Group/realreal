# 2026-06-09 · 行銷模組 × 會員制度 × 點數 全面 audit checkpoint

> **狀態**：階段性檢核（mid-cycle checkpoint），非正式 spec。
> 用途：記錄本 session 改了什麼、哪些 bug 還沒處理、為什麼 defer、下一步要 brainstorm 什麼。
> 下次撿起這份檔案，可直接從「未完成清單」續寫。

---

## 1. 緣起

User 反映 checkout 流程出現多個價錢錯誤：
- 超商取貨運費理論 NT$65、實際收 NT$60
- 帳戶有 4 點公益點數、結帳時顯示 0
- 訂單套用 4 點折抵，總金額沒減
- 信件標題顏色錯（綠色 → 應該品牌深藍）
- 寄件人是 `onboarding@resend.dev` 而不是 `love@realreal.cc`

修完上述 single-issue bug 後，user 要求「全面 audit 行銷模組 + 會員制度 + 點數」，確保「全部功能都要正常、價錢不能錯」。

執行了 **2 輪平行 audit**（91 + 92 agents、~1100 tool calls、~9.7M tokens），找到 63 + 62 confirmed bugs。本 session 修了其中 ~47 個。

---

## 2. Audit 範圍

### Round 1 dimensions（10 平行 finder + adversarial verifier per finding）

| Dim | 範圍 |
|---|---|
| A1 | campaigns evaluator 邏輯（10 種 type 條件判定） |
| A2 | campaigns stacking + pickBestPerType + precedence |
| B1 | tier discount rate |
| B2 | tier upgrade/downgrade trigger |
| C1 | points earn（rate、base、idempotency） |
| C2 | points redeem（calc、balance race） |
| C3 | points expire + refund |
| D1 | orders total precedence + cents/dollars 一致性 |
| D2 | /preview vs POST / 一致性 |
| D3 | post-payment chain（webhook idempotency） |

**Round 1 結果**：82 raw → 63 confirmed real bugs。

### Round 2 dimensions（同 10 維度 + verify recent fixes）

每個 finding 多標一個 `fix_status: fix_works | fix_broken | fix_incomplete | unrelated`，獨立確認 round 1 修補有沒有真的修對 + 抓 regression。

**Round 2 結果**：81 raw → 62 confirmed real bugs（含 17 fix_incomplete、0 fix_broken）。

---

## 3. 已修 commit 列表（按時序）

```
7d0ca5f  6 critical  points/refund/PChomePay idempotency
         + migration 0032: unique partial index on points_ledger
           (earn/redeem) + order_post_payment_log

93e74a0  6 high/med  /preview 一致性 + points cap base + freebie 評分
                     + free-shipping coupon redundancy

e7c8db2  4 high/med  tier expire runtime check + discount_rate clamp
                     + PChomePay queryPayment fail 不 silent ack

545e95c  cosmetic    8 email templates 標題色 #4a7c59 → #10305a

2495633  6 crit/hi   spend mirror reversal on refund (decrementSpendOnRefund)
                     + admin-kols 營收 cents→dollars
                     + refund-payment email cents→dollars
                     + coupon min_order 單位修正
                     + coupon tier_id 強制檢查
                     + tests 改成 await evalFreebie
         + migration 0033: order_post_payment_log.spend_decremented_at

d9e11c3 ~20 全部級別  balance check race (in-flight orders + expired earn)
                     + grantPoints honor tier_expires_at
                     + refundOrderPoints 不重扣已 expire earn
                     + expirePoints .limit(1000) + error logging
                     + PChomePay 必須 notify+status_code 兩邊都 paid
                     + evalDiscount value bounds check
                     + evalBuyXGetY negative max_uses
                     + isInBirthdayWindow 改 asymmetric [-1, +windowDays]
                     + evalFreebie sale_price=0 fallback
                     + pickBestPerType 確定性 tie-break (by campaign_id)
                     + /preview free_shipping coupon 顯示實際省的運費
                     + /preview 加 couponWouldBeRedundant guard
                     + coupon value bounds check (orders.ts + /preview)
                     + tests 全部 48/48 passing
```

**累計 ~47 個 bug 修好，遍及 9 個檔案：**
- `apps/api/src/lib/points.ts`
- `apps/api/src/lib/tier.ts`
- `apps/api/src/lib/campaigns-evaluator.ts`
- `apps/api/src/lib/enqueue-post-payment.ts`
- `apps/api/src/lib/refund-payment.ts`
- `apps/api/src/routes/orders.ts`
- `apps/api/src/routes/coupons.ts`
- `apps/api/src/routes/admin-orders.ts`
- `apps/api/src/routes/admin-kols.ts`
- `apps/api/src/routes/webhooks/pchomepay.ts`
- `apps/api/test/points.test.ts`
- `apps/api/test/campaigns-evaluator.test.ts`

**2026-06-10 續修**：
- L11 checkout 點數預覽鏈路現在共用 POST `/orders` 的 effective redeemable points 規則（`/orders/preview`、`/points/apply`、`/points/balance`）：
  - expired earn rows 不可預覽折抵
  - pending / paid 且尚未寫入 redeem ledger 的訂單點數會先扣掉
  - preview response 額外回傳 `points_balance`；points balance response 額外保留 `ledger_balance`

**Migrations applied to production Supabase**：0032 + 0033。

---

## 4. 已修 bug 的關鍵 take-away

### 4.1 Idempotency（最常見錯誤類別）

所有點數 lifecycle 函式（earn / redeem / refund / expire）+ tier upgrade / period_spend 都加了 idempotency guard：
- **SELECT-first 友善路徑** — 在 INSERT 前先查 (source, source_ref_id) 存不存在
- **DB-level UNIQUE partial index 為 race-safe backstop**（migration 0032）
- **order_post_payment_log table**（migration 0032 / 0033）— 為非 ledger-shaped 副作用（tier upgrade、period spend、spend reversal）提供 sentinel column

### 4.2 Cents vs Dollars 不一致

- `orders.subtotal/shipping_fee/discount_amount/total` 是 `NUMERIC(10,2)` 但存 cents 數字（foundational lie — 還沒修）
- 所有 reader 都需 `/100` 才對。Audit 找到 3 處沒 /100：
  - `admin-kols.ts` KOL 列表營收 → 顯示 100× 太大
  - `refund-payment.ts` admin 退款通知 email → admin 看到錯金額
  - `orders.ts` coupon `min_order` 比對 → cart in cents 比 dollars 永遠通過
- 已逐一修正，但底層 schema lie 仍存在（C4 defer）

### 4.3 /preview 跟 POST / 完全 mirror

`/preview` 原本只算 campaign + points，沒會員、沒 coupon、沒 KOL、沒 free-shipping redundancy。修完後 7 個面向都一致：
- member discount
- campaign discount
- coupon (含 tier_id gate、min_order unit、value bounds、free_shipping redundancy)
- KOL coupon override (kol_ref cookie)
- points cap base = subtotal − member − campaign − coupon
- shipping zero by campaign vs by coupon 互斥
- response shape 包含完整 breakdown

### 4.4 並發 over-redeem 防護

POST / 的 balance 檢查改為 `effectiveBalance = ledgerSum − inFlightUsedPoints`：
- 排除已 expired 的 earn（cron 沒掃完之前不可用）
- 排除 status pending/paid + points_used > 0 + 還沒寫 redeem ledger row 的訂單

對應 critical race（同 user 兩 tab 同時下單）已關閉。

---

## 5. 2026-06-10 續修完成項目

User 要求「整份都修、資料庫也直接搬移」後，採用相容遷移方案：

### 5.1 C4 — orders / order_items 金額單位

- 採 **B 方案**：保留欄位名，將 `orders.subtotal/shipping_fee/discount_amount/total` 與 `order_items.unit_price` 的既有資料從 cents 搬成 TWD dollars。
- Migration：`packages/db/migrations/0034_money_units_twd_and_tier_atomic.sql`，同份 SQL 已透過 Supabase CLI 套到 production project `ozwftlkgqmewtadypsfi`。
- 後端 writer 已改為寫 TWD；API/admin/email/logistics/KOL reader 移除舊 `/100`。

### 5.2 Tier / points

- Tier spend / period spend / charity_savings 改由 DB-side RPC atomic 更新，避免 read-then-write lost update。
- post-payment tier side effect 改用 `claim_order_post_payment_step()` atomic claim，避免 retry / webhook 重送重複加總。
- points earn base 改為「商品 subtotal − 非點數折扣」，排除 shipping，且點數折抵不降低本次 earn base。
- tier-expire worker 改為 cascade downgrade：到期未續等時，直接落到本期 spend 仍符合的最高 tier；不符合則回最低 tier。

### 5.3 Sandbox / payment cleanup

- `test_paid` 改成 production 預設 admin-only；只有 `ALLOW_NON_ADMIN_TEST_PAID=true` 才允許一般登入用戶使用。
- payment row insert 失敗時會 rollback stock / child rows / order，避免留下無付款紀錄的 pending order。
- JKO Pay 失敗 webhook 會在訂單尚未 paid 時 restore stock，再標記 failed。

### 5.4 已知剩餘注意事項

- 這輪保留欄位名做相容遷移，沒有 rename 成 `*_cents`；後續如要更強語意，可另開 breaking schema migration。
- `schema_migration_markers` 防止 0034 資料除以 100 的步驟被重跑。

---

## 6. 驗證方式

### 6.1 自動測試

```bash
cd apps/api && npx vitest run
# 48/48 tests passing
```

### 6.2 手動 smoke test（建議）

1. **/preview vs 結帳價一致**
   - 登入 + 加入 cart NT$1500 + 套 coupon SUMMER100
   - 看 /checkout step 1 顯示 promo state
   - 看 /checkout/payment 顯示同樣金額
   - 看 /checkout/confirm 顯示同樣訂單金額

2. **點數套用真的折抵**
   - 帳戶 4 點 → 套 4 點 → 訂單摘要 NT$X − 4
   - 結帳完成後 ledger 寫 -4
   - admin /admin/orders/<id> 看到 points_used=4

3. **退款補回 + 降 spend**
   - admin 取消已付款訂單
   - 點數退回（admin email 通知含正確 NT$ 金額）
   - user_profiles.total_spend 跟 tier_period_spend 都減回去
   - charity_savings 同比例減

4. **並發保護**
   - 同帳號 2 個 tab，cart 各 NT$1000、各套 100 點
   - 第二個 tab 套用時應顯示 effective balance 已扣 inflight 的 100 點

5. **PChomePay webhook 重送**
   - 同 order 收到 order_confirm + order_paid 兩通知
   - points_ledger 只有 1 筆 earn row
   - user_profiles.total_spend 只 +1 次

### 6.3 Audit log 留存

兩輪 audit 完整結果保留在：
- Round 1: `/private/tmp/claude-501/.../tasks/wzhhebcmb.output`（342k）
- Round 2: `/private/tmp/claude-501/.../tasks/wpqt0wwa1.output`（427k）

每個 finding 含完整 description / expected / actual / reproduction / recommended_fix。後續 brainstorm 可直接 reference。

---

## 7. 下一步建議

### 短期（1-2 工作天）
- [ ] User 跑 smoke test 確認上述 5 個情境都 OK
- [ ] 如果 production 跑 1 週都沒出事 → 砍 `test_paid` 路徑

### 中期（需 brainstorm session）
- [ ] **Tier 系統 spec V**：滾動年 vs 年度結算決策 + DB-side row lock + earn base 決策
- [ ] **Schema migration spec W**：`orders.*` `NUMERIC → INTEGER cents`、批次改 reader

### 長期（已知欠技術債）
- [ ] Resend domain 驗證（user action：在 domain registrar 加 SPF/DKIM/DMARC）
- [ ] Analytics 6 個 service ID 接入（GA / GTM / Sentry / Clarity / LINE Notify / Pixel）

---

## 8. References

- 行銷 spec D（簡化前的點數設定）: `2026-05-30-D-points-rules-simplification-design.md`
- 行銷 campaigns evaluator 原 spec: `2026-05-30-campaigns-evaluator-engine-design.md`
- 公益點數 + 會員 detail 原 spec: `2026-05-30-points-tiers-customer-detail-design.md`
- Order cancellation flow: `2026-05-30-order-state-transitions-and-cancellation.md`
- Migration 0032: `packages/db/migrations/0032_points_ledger_idempotency.sql`
- Migration 0033: `packages/db/migrations/0033_order_post_payment_refund_sentinel.sql`
