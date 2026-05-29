# Customer Account 後台簡化 — 單頁集中設計

**日期**：2026-05-30
**範疇**：`apps/web/src/app/my-account/*`
**目標**：把 6-項側邊欄 + 3-卡 + 2-區塊的結構簡化成單頁集中（hero + 訂單 + 訂閱 + 設定），讓客人 3 秒內看到該看的。

---

## 問題

現況：

- 側邊欄 **6 項**：帳戶總覽 / 我的訂單 / 我的訂閱 / 會員等級 / 個人資料 / 收件地址
- 帳戶總覽主畫面：3 張卡（總訂單、會員等級、累計消費）+ 近期訂單區 + 訂閱方案空狀態
- 「會員等級」既是 sidebar 項目又是首頁卡片 → 重複
- 沒訂閱的客人看到「目前沒有進行中的訂閱」+ 一個按鈕，反而是雜訊
- 一般客人進帳戶只想看 **訂單怎樣了** + **訂閱要不要改**

→ 視覺密度過高，結構讓人「不知道該點哪個」。

## 解法

DTC 慣例的單頁式（Apple / Allbirds / Glossier 都這樣）：

- 刪 sidebar
- 一頁 `/my-account` 集中顯示：hero band + 近期訂單 + 訂閱（條件）+ 帳號設定（折疊）
- 完整訂單清單仍走 `/my-account/orders` 獨立路由

---

## 設計

### Layout（桌機）

```
┌─────────────────────────────────────────────────────────┐
│  歡迎回來，Admin                          [↪ 登出]     │ ← Header row
├─────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐    │
│  │ 👑 初心之友  │  總訂單  5 筆  │  累計消費 NT$ 0 │    │ ← Hero card
│  └────────────────────────────────────────────────┘    │
│                                                         │
│  近期訂單                              查看全部 →       │ ← Section 1 title
│  ┌────────────────────────────────────────┐            │
│  │ RR1780081258657  processing   NT$ 80  →│            │
│  │ 2026/05/29                              │            │
│  ├────────────────────────────────────────┤            │
│  │ WP-3499  待付款  NT$ 129  →             │            │
│  │ 2026/03/08                              │            │
│  └────────────────────────────────────────┘            │
│                                                         │
│  訂閱方案                              管理訂閱 →       │ ← Section 2 (條件)
│  ┌────────────────────────────────────────┐            │
│  │ 蛋白方案-月  active  下次扣款 06/15      │            │
│  └────────────────────────────────────────┘            │
│                                                         │
│  ▶ 帳號設定                                             │ ← Section 3 (折疊)
└─────────────────────────────────────────────────────────┘
```

桌機外層 `max-w-4xl mx-auto px-6`，垂直 `space-y-8`。

### Layout（手機 / `<md`）

- Hero 卡橫向 3 欄改 **直排 3 列**
- 訂單列表 paddings 縮小
- Accordion 展開區裡的 form 欄位全寬

### Hero 卡

3 個欄位橫排，每個欄位有 icon + label + value：

| Icon | Label | Value |
|---|---|---|
| 👑 Crown | 會員等級 | `${tierName}` chip（依等級換背景色） |
| 🛒 ShoppingBag | 總訂單 | `${count} 筆` |
| 💰 Coins | 累計消費 | `NT$ ${totalSpend}` |

- 一張 rounded-2xl 卡 + 細邊框 + bg-white
- 桌機 grid-cols-3，手機 grid-cols-1
- 等級 chip 用品牌色 `#10305a` (background) + white text；其他等級可預留變化

### 近期訂單 Section

- title 「近期訂單」+ 右上 link 「查看全部 →」→ `/my-account/orders`
- 抓 `orders` API：**最新 5 筆**（按 `created_at desc`）
- 每列：
  - 左：order_number（mono font）+ 日期（小字 muted）
  - 右：status badge + 金額 + Chevron
- 點任一列 → `/my-account/orders/[id]`
- 0 筆 → empty state 「還沒有訂單，去逛逛 →」CTA 連 `/shop`

### 訂閱方案 Section（條件顯示）

- **active subscription 數量 > 0 才顯示這個 section**
- title 「訂閱方案」+ 右上 link 「管理訂閱 →」→ `/my-account/subscriptions`
- 每列：plan_name + status badge + 下次扣款日期
- 點任一列 → `/my-account/subscriptions`（短期）或未來 `/my-account/subscriptions/[id]`

### 帳號設定 Section（折疊）

- title 行 `▶ 帳號設定`，點擊翻轉成 `▼ 帳號設定` + 展開
- 預設 **collapsed**
- 展開內容：
  - 顯示名稱 (display_name) — input
  - 手機號碼 (phone) — input
  - Email — read-only（顯示已綁定的 auth.email，旁邊「變更需聯絡客服」小字；email 改動本來就應該走 OTP，這版不做）
  - **收件地址** — 子區，sub-heading + 列表 + 「新增地址」按鈕。每筆地址：姓名/電話/地址 + 編輯 / 刪除按鈕
  - 底部「儲存帳號資料」按鈕（只儲存名 + 電話；地址各自獨立 CRUD）

### Header row（最上面）

- 左：「歡迎回來，`{name || email}`」+ 副標「管理您的訂單與設定」
- 右：「登出 →」按鈕（icon LogOut，邊框樣式）

---

## 路由變動

| 路由 | 動作 |
|---|---|
| `/my-account` | **rewrite** 成本文設計 |
| `/my-account/layout.tsx` | **rewrite** — 拿掉 sidebar，改成全寬內容區（auth check 保留） |
| `/my-account/orders` | 保留，**加 breadcrumb**「← 回帳戶概覽」 |
| `/my-account/orders/[id]` | 保留，**加 breadcrumb** |
| `/my-account/subscriptions` | 保留（接收「管理訂閱」連結） |
| `/my-account/profile` | **刪除整個資料夾** |
| `/my-account/addresses` | **刪除整個資料夾** |
| `/my-account/membership` | **刪除整個資料夾** |

---

## 資料來源（沿用既有 API）

| 用到 | API endpoint | 備註 |
|---|---|---|
| 用戶基本資料 | `auth.users` via Supabase client | 既有 layout 已查 |
| display_name / phone | `user_profiles` | 既有 query |
| 訂單列表 + 計數 + 總消費 | `/orders` (requires auth) | 取 `limit=5&sort=-created_at`；計總額 + count 直接 sum 全部訂單 |
| 訂閱列表 | `/subscriptions` | 取 status=active 的 |
| 地址列表 + CRUD | `/users/me/addresses` 或現有 endpoint | 沿用 `/my-account/addresses` 原本 hit 的 endpoint |
| 等級 | `user_profiles.tier` 或 `tier` 表 | 既有 layout 已查 |

如果某個 endpoint 不存在或不便聚合，**在 `/my-account/page.tsx` 用 Server Component 一次 parallel fetch**（不是新 BFF）。

---

## 元件分工

`apps/web/src/app/my-account/page.tsx`（Server Component 入口）：
- parallel fetch：profile / orders(top 5 + count + sum) / subscriptions / addresses
- 把結果 props 下灌給 `<AccountDashboard />` (Client Component)

`apps/web/src/app/my-account/_components/`（新資料夾）：
- `AccountHeader.tsx`：左 title + 右登出
- `HeroCard.tsx`：3 欄統計
- `RecentOrdersSection.tsx`：清單 + 空狀態
- `SubscriptionsSection.tsx`：清單（conditional render — 父層判斷後傳空陣列就不出現）
- `AccountSettingsSection.tsx`：accordion + form + 地址 CRUD

`apps/web/src/app/my-account/layout.tsx`：
- 保留 auth check + redirect
- 不再 render sidebar
- 簡單包一個 `<div className="bg-zinc-50 min-h-screen">{children}</div>`

---

## 邊角

| 情境 | 處理 |
|---|---|
| 0 訂單 | 訂單區顯示 empty state CTA |
| 0 訂閱 | 訂閱區整段 hidden |
| 0 地址 | 帳號設定展開後地址子區顯示「尚未新增收件地址」+ 新增按鈕 |
| Hero 卡某欄位 loading 中 | skeleton placeholder（既有有 `Skeleton` component） |
| 已登入但 `user_profiles` 還沒建 row | display_name fallback 到 email username 部分（既有處理） |
| /my-account/profile 既有客人從外部連結進來 | 改 redirect 到 `/my-account#account-settings`（保留 anchor 讓 accordion auto-expand）— 不打 404 避免老 email 連結爆 |

---

## 不做（YAGNI）

- 訂閱 inline 編輯（仍走 `/my-account/subscriptions` 那邊既有 UI）
- Email 變更流程（read-only 顯示就好，這版不做改 email 的 OTP）
- 地址設「預設」+ 排序（既有不需要的話不加）
- 訂單篩選 / 搜尋（深層的 `/my-account/orders` 才需要）
- 將「登出」按鈕做成 confirm dialog（沒必要）

---

## 驗證

1. **桌機 happy path**：登入 → `/my-account` → 看到 hero（3 欄）+ 5 筆訂單 + 訂閱（如果有）+ 帳號設定（折疊）
2. **手機**：DevTools 切 iPhone → hero 變直排、訂單清單單欄
3. **0 訂單帳號**：建一個全新測試帳號 → 看到「還沒有訂單」CTA
4. **沒訂閱帳號**：訂閱 section 完全不出現（不只是空狀態 — 整段消失）
5. **帳號設定**：展開 → 改名 → 儲存 → 重整還在
6. **地址 CRUD**：新增地址 → 編輯 → 刪除 → 都立即反映在清單上
7. **登出**：右上「登出」→ 回首頁
8. **舊路由**：手動打 `/my-account/profile`、`/my-account/addresses`、`/my-account/membership` → redirect 到 `/my-account`（不該 404）
9. **訂單詳情 breadcrumb**：點訂單列 → `/my-account/orders/[id]` → 左上「← 回帳戶概覽」可以點回

---

## 相關檔案

新增：
- `apps/web/src/app/my-account/_components/AccountHeader.tsx`
- `apps/web/src/app/my-account/_components/HeroCard.tsx`
- `apps/web/src/app/my-account/_components/RecentOrdersSection.tsx`
- `apps/web/src/app/my-account/_components/SubscriptionsSection.tsx`
- `apps/web/src/app/my-account/_components/AccountSettingsSection.tsx`

改：
- `apps/web/src/app/my-account/page.tsx`（重寫）
- `apps/web/src/app/my-account/layout.tsx`（拿掉 sidebar）
- `apps/web/src/app/my-account/orders/page.tsx`（加 breadcrumb）
- `apps/web/src/app/my-account/orders/[id]/page.tsx`（加 breadcrumb）

刪除（資料夾整個 `git rm`）：
- `apps/web/src/app/my-account/profile/`
- `apps/web/src/app/my-account/addresses/`
- `apps/web/src/app/my-account/membership/`

新增 redirect（在 layout 或 next.config 或刪除目錄改寫 page.tsx 為 redirect）：
- `/my-account/profile` → `/my-account`
- `/my-account/addresses` → `/my-account`
- `/my-account/membership` → `/my-account`

選擇：用 stub `page.tsx` 做 `redirect('/my-account')`（最簡單，避免動 next.config）。
