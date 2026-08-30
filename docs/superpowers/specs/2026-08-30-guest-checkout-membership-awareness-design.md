# 訪客結帳會員意識提升設計（Guest Checkout Membership Awareness）

日期：2026-08-30

## 背景與問題

多位客人下單後才發現自己沒有加入會員 —— 具體來說是**下單時完全沒意識到自己是以訪客身份結帳**，一直到之後想查訂單、想用點數、或發現沒享受到會員福利，才驚覺沒有帳號。

觸發此設計討論的實際案例是訂單 `#10000158`（歐陽靖雯）：她以訪客身份下單，14 分鐘後透過一般 `/auth/register` 表單另外註冊了帳號，但這筆訂單沒有自動歸戶，只能靠聯絡客服手動處理。這個技術面的缺口本身已在本次會期修好（見下方「已存在的安全網」），但根本問題——**客人一開始就沒被清楚告知自己是訪客**——尚未解決，本設計要處理的正是這一塊。

### 現況盤點

結帳流程（`apps/web/src/app/checkout/page.tsx`）目前完全沒有任何登入/會員提示——不管是頁首、表單區塊、或 email 欄位旁，一個字都沒提到。客人只有在**付款成功之後**，`/checkout/confirm` 頁面才會條件式地顯示 `GuestRegisterCard`（見 `apps/web/src/components/checkout/GuestRegisterCard.tsx`）：一鍵建帳號 + 自動認領同信箱下的所有訪客訂單。但這張卡片：

- 只有一次曝光機會，若客人在此之前就關閉分頁 / 被金流導頁流程打斷注意力 / 沒耐心往下滑，就永久錯過
- 而訂單確認信（`apps/api/src/emails/OrderConfirmation.ts`）完全沒有提到會員這件事，也就是說，客人一旦錯過 confirm 頁那次曝光，往後**沒有任何管道**會再提醒他們可以加入會員並把這筆訂單納入帳號

決策依據（brainstorming 對話中確認）：
- 提醒力度不能造成阻礙——不強迫在結帳前二選一（登入會員／訪客結帳），只需要「顯眼但不擋路」
- 訂單確認信要補上會員提醒，作為結帳頁提醒之外的第二道保險

## 設計

三層防護網，由前到後：

### 1. 結帳頁提醒卡（新增）

**位置**：`/checkout` 頁面（收件資訊步驟），放在「收件資訊」標題正上方，與現有「🎟 優惠碼」「✨ 公益存款」卡片同一視覺語言（白底、灰框、`rounded-lg border`）—— 不是全寬橫幅，是一張與其他卡片並列的普通卡片。

**顯示條件**：僅在使用者未登入時顯示。判斷方式沿用 `checkout/confirm/page.tsx` 已有的 pattern——`supabase.auth.getUser()` 一次性檢查，成功拿到 user 就整張卡片不渲染。已登入會員完全看不到這張卡，不影響既有結帳體驗。

**內容**：
```
🎁 已經是會員了嗎？
登入即可套用首購折抵與點數回饋
                              [登入 →]
```

**互動**：「登入」按鈕連到 `/auth/login?next=/checkout`。登入頁本身已支援 `?next=`（`apps/web/src/app/auth/login/page.tsx:73`），登入成功後會導回 `/checkout`。購物車是 zustand + localStorage 持久化（見 `apps/web/src/app/checkout/confirm/page.tsx` 對 `clearCart`/`localStorage.removeItem("realreal-checkout")` 的處理），不受站內導頁影響，登入完回到結帳頁購物車內容原封不動。全新訪客（還沒有帳號）可以從登入頁既有的「還沒有帳號？立即註冊」連結去註冊——這裡不需要另外導向訪客一鍵註冊流程，因為此時客人還沒有訂單可供驗證身份。

**不做的事**：不加關閉／dismiss 按鈕（卡片本身不擋路，不需要讓人手動關掉）；不強迫二選一頁面；不在步驟 2（付款方式）重複顯示——出現一次在最一開始，是客人開始填資料前最早也最容易被看到的時機點。

### 2. 訂單確認信新增「加入會員」提醒（新增）

**重要修正**：寫這份設計時最初以為訂單成立信是 `apps/api/src/emails/OrderConfirmation.ts`（`renderOrderConfirmation`），但寫實作計畫前重新確認程式碼發現這個檔案其實是**死碼**——它的 `"order-confirmation"` template 從未被任何呼叫端 enqueue 過。客人實際收到的「訂單成立」信其實有兩條完全不同的路徑，兩個都要加：

1. **線上付款成功**（LinePay / PChomePay / JKOPay）：`apps/api/src/lib/enqueue-post-payment.ts` 的 `enqueuePostPaymentJobs()`（約 162 行）呼叫 `renderAndSendEmail({ template: "payment-confirmed", ... })`，實際範本在 `apps/api/src/emails/PaymentConfirmed.ts` 的 `renderPaymentConfirmed`。這條路徑會先查 `site_contents`（`TEMPLATE_KEY_MAP["payment-confirmed"] = "email_payment_confirmed"`），有資料庫範本就完全蓋掉程式碼版本。
2. **超商取貨付款（COD）**：同一檔案的 `notifyOrderPlacedCod()`（約 366 行）在訂單一成立（尚未付款）時，直接組一段內嵌 HTML 字串呼叫 `sendEmail()`，完全不經過 `email-sender.ts` 的樣板系統，也就不受 `site_contents` 影響。

兩條路徑呼叫時，`order.user_id` 與 `order.guest_email` 都已經在同一次 `supabase.from("orders").select(...)` 查詢裡撈出來了（分別在 `enqueuePostPaymentJobs` 第 34 行、`notifyOrderPlacedCod` 第 370 行），`isGuestOrder = !order.user_id` 兩處都能直接算，不用額外查詢。

**顯示條件**：僅在該訂單為訪客訂單（`guest_email` 非空、`user_id` 為 null）時顯示；會員下單完全不加這段。

**內容（草案）**：
```
💡 想讓這筆訂單也算進會員？
加入會員即可累積公益存款點數、下次購物更快結帳，
也能隨時查詢這筆訂單狀態。
                                    [加入會員 →]
```

**CTA 連結**：直接導回 `https://realreal.cc/checkout/confirm?order=<orderNumber>`。這個頁面（`apps/web/src/app/checkout/confirm/page.tsx`）本來就會依訂單編號查詢 `/orders/by-number/:n/status`，若判斷是訪客訂單且未登入，就會自動渲染 `GuestRegisterCard`——也就是說**不需要新頁面、不需要新後端邏輯**，直接重用已經上線、已測試過的一鍵建帳號 + 自動認領同信箱訪客訂單流程（`POST /auth/legacy/register-from-guest`）。

**⚠️ 實作風險（務必在動工前確認）**：`payment-confirmed` 這條路徑受 `site_contents` DB 範本覆蓋影響（先前改信件版型時發生過這問題——見 memory）。實作計畫必須包含「先查 `site_contents` 有沒有 `email_payment_confirmed` 這筆資料」這一步——如果有，要嘛編輯那筆資料庫紀錄，要嘛比照上次做法整筆刪除讓程式碼版本重新生效，否則改了 `PaymentConfirmed.ts` 客人收到的信仍然不會變。`notifyOrderPlacedCod` 這條路徑沒有這個風險（不經過 DB 範本系統）。

### 3. 已存在的安全網（本次會期已上線，不在本設計範圍內，僅記錄關聯）

即使客人略過以上兩個 CTA，自行前往一般 `/auth/register` 表單、用同一組 email 重新註冊，Email 驗證連結點擊成功的當下（`apps/web/src/app/auth/confirm/route.ts`）也會呼叫 `POST /auth/legacy/claim-guest-orders`，自動把所有符合信箱的訪客訂單歸戶——不需要客人記得訂單編號，也不需要聯絡客服。這個功能已於本次會期完成、測試、上線（commit `3b2618a`），是這整套會員意識問題三層防護網的最後一道。

## 不做的事（YAGNI）

- 不強迫「登入會員／訪客結帳」二選一頁面
- 不在結帳頁多個步驟重複顯示提醒卡
- 不新增訪客結帳前的「快速註冊」表單（複雜度高、且與既有的訂單後一鍵註冊功能重複）
- 不修改既有的 `GuestRegisterCard` 元件邏輯本身——本設計只是多開兩個入口導向它已存在的能力

## 測試考量

- 結帳頁提醒卡：未登入時顯示、已登入時不顯示（`vitest` 或既有 component test pattern，若有的話；否則走既有的手動瀏覽器驗證流程）
- 確認信：訪客訂單收到含 CTA 的信、會員訂單收到的信不含這段（可能需要 mock `email-sender.ts` 呼叫並斷言 HTML 內容）
- 端對端：實際用訪客身份下單 → 收信 → 點「加入會員」→ 確認導回 confirm 頁且能看到 `GuestRegisterCard` → 完成一鍵註冊 → 確認訂單歸戶
