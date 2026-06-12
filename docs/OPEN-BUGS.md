# 待修 Bug 清單（2026-06-12 註冊/忘記密碼/行銷模組體檢）

> 來源：2026-06-12 三面向平行體檢（auth flows / coupons+campaigns / tiers+points+KOL）。
> ✅ 已修並上線的不在此列（見 git log）。本檔只列**尚未修**的，給決策 + 交接用。

## ✅ 本次已修（wave A，commit e6cef23 / 2c5e105 / abd42bd）
- **固定金額優惠券差 100 倍**：`coupon.value` 是元、卻當分套用（NT$200 券只折 NT$2）。已修 `orders.ts:585/271` + `campaigns.ts:314`（×100）。
- **登入 open redirect**：`redirectTo` 未驗證 → `?redirect=//evil` 可導去釣魚站。已加同源檢查 `auth/actions.ts`。
- **登入回跳失效**：proxy 寫 `?next=` 但登入頁讀 `?redirect=`，深連結回跳壞掉；callback 錯誤也沒顯示。已修 `auth/login/page.tsx`。
- **RLS 全表外洩**（migration 0036，已套用線上 + 驗證關閉）；variants 庫存權限、PChomePay 金額比對、coupon/validate 收斂、amego.webhook_secret。

---

## 🔴 P0 — 可被一般客人利用 / 併發出錯（需 DB migration + 原子化）

### B1. 點數可被併發訂單重複折抵 → 餘額變負
`lib/points.ts:524-567` 算可用餘額，但 `orders.ts:606-631` 下單時**沒有原子鎖住點數**（不像庫存 `atomic_deduct_stock`、優惠券 `atomic_increment_coupon_usage`）。兩筆結帳同時送：各自看到全額餘額 → 都通過 → 付款時各寫一筆負數 → 折抵超過實際持有、餘額變負。
**修法**：寫一支 `atomic_redeem_points` RPC（同交易內重新核對 effective balance 並記錄 hold），下單時呼叫。**需 migration。**

### B2. 退款時會員消費額可能被重複扣（併發 cancel）
`lib/tier.ts:180-207`：先讀 `spend_decremented_at`(null)→ 扣 → 再 claim，非原子。兩個 cancel 併發（PATCH + POST，或 webhook retry）都通過早退讀取、都執行扣除 → 消費額/公益金被扣兩次、可能誤降等。
**修法**：改成 **claim-then-act**（先 `claim_order_post_payment_step('spend_decremented')` 回 true 才扣），把扣除放進同一支 SQL function。**需 migration。**

---

## 🟠 P1 — 嚴重邏輯 / 金額整備

### B3. 優惠券用量在「下單即扣、取消不還、且 coupon_uses 從未寫入」
`orders.ts:569` 下單(pending、未付款)就 `atomic_increment_coupon_usage`，但：
- 任何 webhook 都不在「付款成功」才加 → **棄單/付款失敗也永久消耗一次**。
- 取消/退款路徑（`admin-orders.ts` PATCH/cancel）**完全不還** used_count。
- `coupon_uses` 這張表**從沒被 insert**（grep 全庫零筆）→ 每人使用次數限制形同虛設；先前加在 hard-delete 的「回補 used_count」其實在讀空集合 = 死碼。
**修法**：下單成功時 insert `coupon_uses`；把 increment 移到付款成功路徑（或在每個失敗 rollback + 取消路徑加 `atomic_decrement_coupon_usage`）。**需 migration（decrement RPC）。**

### B4. 退款後等級永不降、且「永久等級」永不複查
`lib/tier.ts:141-221` 退款只扣消費額、不重評等級；`tier-expire.ts:70` 只掃 `tier_expires_at IS NOT NULL`。但 `validity_months=0` 的永久等級 expiry 是 NULL → 永遠掃不到 → 刷單升鑽石後退款、鑽石保留到永遠。
**修法**：退款使消費額低於現等級門檻時即時降等；或讓 sweep 也涵蓋無到期日的等級。

### B5. 點數金流路徑吞錯（phantom success）
`lib/points.ts`：`adjustPoints`(484)、`refundOrderPoints`(449)、`redeemPoints`(260) 都 `Promise<void>` 且不檢查 insert `.error`。admin 手動加點(`admin-customers.ts:236`)、升等贈點(`tier.ts:89/251`)、退款回點都會「回報成功但其實沒寫入」。
**修法**：檢查 `.error` 並 throw/回傳狀態，讓呼叫端能 500/重試。（純程式，但要改函式簽名 + 呼叫端 try/catch。）

### B6. 升等claim 在成功前就蓋章
`enqueue-post-payment.ts:38-48`：先 claim `tier_incremented` 再呼叫 `incrementSpendAndUpgrade`；RPC 暫時失敗被吞 → claim 已消耗 → 重試跳過 → 訂單已付款但消費額never計。
**修法**：成功後才蓋章（claim-after-success），或 claim+RPC 同交易。

### B7. 忘記密碼/註冊確認連結只能在「原瀏覽器」開（PKCE cookie-bound）
`auth/actions.ts` 的 reset/signup 走 server-action PKCE，`code_verifier` 存在原瀏覽器 cookie；手機開桌機寄的信 → `exchangeCodeForSession` 失敗 → 連結看似壞掉。極常見。
**修法**：recovery 改走 token-hash 流程（`verifyOtp({type:'recovery', token_hash})`），裝置無關。

---

## 🟡 需產品決策 / 資料確認

### B8. KOL 自我推薦灌佣金（需 schema）
`KolRefCapture.tsx` + `orders.ts:424-447`：任何人帶 `?ref=<slug>` 就拿該 KOL 折扣（聯盟行銷本意，OK）；但 KOL 自己帶自己 ref 下單可灌自己的佣金。`kols` 表**沒有 user_id**，無法判斷「買家=該 KOL」。佣金目前只是後台**顯示估算**、非自動撥款（admin 撥款前會審），故非自動失血。
**修法**：加 `kols.user_id`，下單時排除 buyer==KOL 的佣金歸屬。**需 migration + 產品決策。**

### B9. 生日券折扣單位（需查線上資料）
`campaigns-evaluator.ts:586`：折扣值期待整數百分比，但舊資料/seed 可能存 `0.95`（折數）→ 變成「打 0.95% 折」而非 5% off。只影響仍帶舊 `discount_value<1` 的活動列。
**修法**：先查線上 `campaigns` 是否有 `discount_value<1` 的列；有則資料遷移成整數百分比，或讓 evaluator 偵測 `0<value<1` 當折數。

---

## 🟢 P2 — 次要
- 疊加活動折扣無總額 clamp（`orders.ts:509-524`）：多個 admin 活動疊加可超過小計，靠最終 `max(0,…)` 兜底。建議 `min(campaignDiscount, subtotal)`。
- `/coupons/validate` 未檢查 `applicable_to`（訂閱券可用於一般單）。
- KOL 佣金 `est_commission` rounding 語意錯（`admin-kols.ts:125…`，巧合正確但脆弱）。
- 重複 Email 註冊訊息誤導（防列舉行為，建議改文案）。
- `tier.ts:4-9` 死的 `TIERS` 常數與 DB 不一致，建議刪。
