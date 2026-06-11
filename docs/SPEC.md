# 誠真生活電商平台 — 系統規格與白標模組化白皮書

> **文件用途**：這是整個平台的**單一事實來源 (single source of truth)**，給未來接手的工程師 / AI agent 用來理解系統、做決策、安全地擴充。
> **產品目標**：把這套電商變成一個**可白標、功能可勾選、後台自動生成**的網站模組產品 —— 客戶勾選要的功能，系統依勾選結果產出一個只含那些功能、套上客戶品牌的網站。
> **最後更新**：2026-06-12 ｜ **狀態**：架構規劃中（改造尚未開始，僅完成安全急救 0036）

---

## 0. 給未來 Agent 的快速上手

- **倉庫**：Turborepo monorepo。`apps/web`（Next.js 15 App Router → Vercel）、`apps/api`（Express + Supabase + BullMQ → Railway）、`packages/db`（SQL migrations）。
- **部署**：API/worker 從 GitHub `main` 自動部署到 Railway；web 推上去 Vercel 自動部署。**Supabase schema 是 Dashboard 手動管理的**——migration 檔是紀錄，不會自動套用，要把 SQL 貼進 Supabase SQL Editor 手動執行。詳見 [DEPLOYMENT.md](../DEPLOYMENT.md)。
- **三條鐵律**（踩過的坑，務必遵守）：
  1. **Supabase 寫入會「靜默失敗」**——`.insert/.update/.delete` 不檢查 `.error` 就不會知道失敗。所有寫入都要 `const { error } = ...` 並處理。
  2. **金額單位**：DB 欄位自 migration `0034` 起存「新台幣元」；API request 的 `items[].unitPrice` 是「分(cents)」；`orders.ts` 內部用 cents 運算，寫入邊界用 `centsToTwd()` 轉換。**動到金額一定要確認單位**。
  3. **API 用 service-role key（繞過 RLS）；前台用 anon key（受 RLS 管制）**。安全性靠 RLS 政策（見 §4）。
- **驗證方式**：`apps/api` → `npx tsc --noEmit` + `npx vitest run`；`apps/web` → `npx tsc --noEmit -p tsconfig.json` + `npx eslint <file>`。注意 `node_modules` 掛在 repo root（npm workspaces hoist），binary 跑 root 的 `node_modules/.bin`。

---

## 1. 系統概觀

### 1.1 技術棧
| 層 | 技術 |
|---|---|
| 前台/後台 | Next.js 15 (App Router, RSC)、TypeScript、Tailwind、shadcn-style UI、sonner |
| API | Express + TypeScript、Supabase JS (service-role)、BullMQ (Redis) |
| 資料庫 | Supabase Postgres（schema 由 Dashboard 管理）|
| 背景工作 | 7 個 worker（見 §2）：email、inventory、invoice、logistics、points-expire、subscription-billing、tier-expire |
| 金流 | PChomePay、LINE Pay、JKOPay、超商取貨付款 (ECPay COD) |
| 物流 | ECPay 綠界（超商 C2C + 宅配 + COD 代收）|
| 電子發票 | Amego |
| 通知 | Resend (email)、LINE Notify |

### 1.2 規模
API ~12k 行 / 25 路由檔 / 7 worker；Web ~29k 行；37 個 migration；33 張表；後台 17 個功能區。

### 1.3 現況部署架構（單租戶 / 單品牌）
一套 = 一個 Supabase + 一個 Railway 專案（api + worker）+ 一個 Vercel。品牌（名稱/顏色/logo/網域）目前**寫死在程式碼約 660 處**。詳見 §5（白標改造）。

---

## 2. 模組目錄 (Feature Modules)

> 這是模組化的基礎。**核心 (CORE)** = 電商不能沒有它；**可選 (OPT)** = 客戶可勾掉。最後一欄「切換難度」= 要做到可開關所需的重構成本。

| # | 模組 | API 路由 | 後台/前台頁面 | Worker | 主要表 | 類別 | 切換難度 |
|---|------|---------|--------------|--------|-------|------|---------|
| 1 | 認證/會員/個資 | `users`,`admin-team`,`admin-customers` | `auth`,`my-account`,`admin/customers`,`admin/users` | — | `user_profiles`,`user_addresses` | **CORE** | — |
| 2 | 商品目錄 | `products`,`variants`,`categories` | `shop`,`category`,`search`,`admin/products`,`admin/categories` | — | `products`,`product_variants`,`categories` | **CORE** | — |
| 3 | 購物車/結帳/訂單 | `orders`,`admin-orders` | `checkout`,`my-account/orders`,`admin/orders` | inventory | `orders`,`order_items`,`order_addresses`,`payments` | **CORE** | — |
| 4 | 系統設定 | `admin-settings` | `admin/settings` | — | `app_settings` | **CORE** | — |
| 5 | 會員等級 | `tiers` | `membership`,`admin/membership` | tier-expire | `membership_tiers` | OPT | 高 |
| 6 | 點數/公益 | `points` | （my-account、結帳）| points-expire | `points_ledger` | OPT | 高 |
| 7 | 優惠券 | `coupons` | `admin/coupons` | — | `coupons`,`coupon_uses` | OPT | 中 |
| 8 | 行銷活動 | `campaigns` | `admin/campaigns`,`admin/marketing` | — | `campaigns` | OPT | 高 |
| 9 | KOL 分潤 | `kols`,`admin-kols` | `k/[slug]`,`admin/kols` | — | `kols`,`kol_clicks` | OPT | 中 |
| 10 | 訂閱制 | `subscriptions` | `subscribe`,`my-account/subscriptions`,`admin/subscriptions` | subscription-billing | `subscriptions`,`subscription_plans`,`subscription_orders` | OPT | 低-中 |
| 11 | 商品評論 | `reviews` | `admin/reviews`、商品頁 | — | `product_reviews` | OPT | 低 |
| 12 | 電子發票 | `invoices`,`webhooks/amego` | `admin/invoices` | invoice-issuer | `invoices` | OPT | 中 |
| 13-16 | 金流（各家）| `webhooks/{pchomepay,linepay,jkopay}` | — | — | `payments` | OPT（至少 1 家 CORE）| 中 |
| 17 | 物流（ECPay）| `logistics`,`webhooks/ecpay-logistics` | 結帳取貨 | logistics-creator | `logistics` | OPT（至少 1 種 CORE）| 中 |
| 18 | Email/通知 | — | `admin/email-templates` | email-sender | `email_templates` | OPT | 中 |
| 19 | 部落格/CMS | `posts`,`post-categories`,`post-tags` | `blog`,`idea`,`admin/posts` | — | `posts`,`post_*` | OPT | 低 |
| 20 | 站內文案 CMS | `site-contents` | `about`,`faq`,`terms`… | — | `site_contents` | OPT | 低 |
| 21 | 分析儀表板 | `analytics` | `admin/analytics` | — | （讀 orders/profiles）| OPT | 低 |

### 2.1 模組耦合（要解的結）
```
會員等級 → 點數 → 行銷活動 → 優惠券 → 會員等級   （近乎循環依賴，最難切）
KOL → 優惠券；訂閱 → 商品變體；分析 → 訂單（唯讀）
```
**三大耦合熱點**（模組化前必須解開）：
1. **`lib/enqueue-post-payment.ts`**：一個函式硬寫死 7 件付款後動作（升等、客人信、admin 信、LINE 通知、發票、物流、點數）→ 需改成**事件總線**。
2. **`routes/orders.ts`（~1039 行）**：inline 整條折扣鏈（等級→活動→優惠券→點數→KOL）+ 金流 `if/else` switch + 把模組專屬欄位反正規化塞進 `orders` 表 → 需改成**折扣外掛鏈 + 金流 registry**。
3. **會員/點數/活動/優惠券** 四者 lib 互相 import + 跨表 FK → 需拆 lib 交叉依賴。

**現在就能輕鬆切的**（低風險）：評論、部落格、站內文案、分析、（接近）訂閱。

---

## 3. 資料模型

### 3.1 表清單（33 張）
核心：`user_profiles` `categories` `products` `product_variants` `orders` `order_items` `order_addresses` `payments` `logistics` `invoices`。
模組：`membership_tiers` `points_ledger` `coupons` `coupon_uses` `campaigns` `kols` `kol_clicks` `subscriptions` `subscription_plans` `subscription_orders` `product_reviews` `posts` `post_categories` `post_tags` `post_tag_links` `site_contents` `media`。
系統：`app_settings` `app_settings_audit` `webhook_events` `order_post_payment_log` `order_idempotency_keys` `schema_migration_markers`。
View：`v_user_points_balance`。

### 3.2 重要關聯與慣例
- **金額單位**：所有 `NUMERIC(10,2)` 欄位 = 新台幣元（since `0034`）。
- **訂單子表 FK**：`order_items`/`order_addresses`/`order_post_payment_log` 為 `ON DELETE CASCADE`；`payments`/`logistics`/`invoices`/`coupon_uses`/`subscription_orders` 無 CASCADE（刪訂單會被擋）。商品軟刪除見 `0035`、`products.deleted_at`/`orders.deleted_at`。
- **角色**：`user_profiles.role ∈ customer/admin/editor/viewer`。`requireAdmin` 只認 `admin`；`requireEditor` 認 `admin`+`editor`。

---

## 4. 安全架構

### 4.1 RLS（列級安全）— migration 0036【關鍵】
> **背景**：0036 之前 RLS 全關，前台 anon key 可讀全部表 → 任何人能整包下載客戶 PII。**這是上線前的硬門檻，每個新部署都必須套用 0036。**

模型（見 [0036_CRITICAL_enable_rls.sql](../packages/db/migrations/0036_CRITICAL_enable_rls.sql)）：
- API service-role **繞過 RLS** → 後端不受影響。
- **公開讀**：商品/分類/等級/方案/活動/文案/部落格/評論/media。
- **擁有者+admin 讀**：訂單、個資、點數、訂閱 + 訂單子表（經父訂單判斷擁有權）；admin 透過 `SECURITY DEFINER` 的 `is_admin()` 判斷。
- **僅 admin 讀**：優惠券、KOL、點擊分析。
- **僅 service-role**：內部表（webhook_events 等）。
- **`user_profiles` 自助更新**：用 column-level GRANT 限制客人只能改 `display_name`,`phone`（杜絕自我升級成 admin）。

### 4.2 金流完整性（已做得扎實）
- Server 端用 DB 價格重算金額，不信任 client 傳的 `unitPrice`（`orders.ts`）。
- Webhook 強制驗簽（fail-closed）：JKOPay HMAC、Amego `timingSafeEqual`、ECPay CheckMacValue、LINE Pay 用 confirm 比對金額。
- Idempotency：`webhook_events` 唯一鍵 + `order_post_payment_log` claim-once → 不重複給點/出貨/退款。

### 4.3 待修安全項（非 P0，但賣出前要清）
| 級別 | 位置 | 問題 | 修法 |
|---|---|---|---|
| P1 | `variants.ts:80` | 改庫存只擋 requireAuth | 加 requireAdmin + 原子 RPC |
| P1 | `webhooks/pchomepay.ts` | 沒比對實付金額 vs 訂單金額 | `queryPayment` 回金額並比對 |
| P2 | `lib/settings.ts` SECRET_KEYS | `linepay.channel_secret`/`ecpay.hash_iv`/`amego.webhook_secret` 未遮罩 | 加入 SECRET_KEYS |
| P2 | `coupons/validate` | 回完整 coupon 設定，可被列舉 | 只回 `{valid,discount}` + 限流 |
| — | anon key | 是舊版 anon JWT | 換新版 restricted publishable key（RLS 開了之後此項風險已大幅下降）|

### 4.4 白標多客戶的新增安全要求
- **每客戶獨立密鑰**：`SETTINGS_ENCRYPTION_KEY`、`TOKEN_ENCRYPTION_KEY`、`INTERNAL_API_SECRET`、各金流憑證**每個客戶各自一份**——共用一把就等於一個客戶外洩、全部客戶遭殃。
- **CORS allowlist 目前寫死**（`app.ts:5-11`）→ 必須改成 per-deploy env。
- `next.config.ts` 的 `images.remotePatterns`、`urls.ts` 的 legacy fallback 也寫死 realreal.cc → 需 env 化。

---

## 5. 白標 / 租戶模式：兩種取捨（**待你決定**）

這是最關鍵的架構岔路，決定安全模型與整個改造工程。

### 模式 A：每客戶獨立部署（**建議**）
每個客戶一套自己的 Supabase + Railway + Vercel + 一份 env。勾選功能 = 開關 feature flag + 填品牌設定。
- ✅ **資料完全隔離**——一個客戶出事不波及其他人（最符合「不能讓客戶資料外洩」）。
- ✅ 現有架構幾乎可直接用，不必動每張表。
- ✅ 客製化、改版、下架單一客戶都獨立。
- ⚠️ 每個客戶要佈建 3 套服務 + 跑一次 schema + 設定密鑰 → 需要**佈建自動化腳本**（見路線圖 Phase 4）。
- ⚠️ 多客戶時營運成本/管理較高（但可腳本化）。

### 模式 B：一套系統多租戶
一套服務所有客戶，共用資料庫加 `tenant_id`。
- ✅ 營運成本低、升級一次到位。
- ❌ **每張表都要加 `tenant_id` + 租戶級 RLS**，service-role API 每個查詢都要過濾租戶——現在完全沒有，工程量與風險都大。
- ❌ 一個 RLS/查詢漏掉租戶過濾 = 跨客戶資料外洩，blast radius 是全部客戶。
- ❌ 客製化困難（共用 schema/程式）。

### 建議
以你「賣一整包」「要非常安全」的目標，**模式 A（每客戶獨立部署）** 是對的：隔離最強、現有架構可用、客製彈性高。模式 B 的省成本不值得它帶來的跨租戶外洩風險。**規格其餘部分以模式 A 撰寫**；若你選 B，§4.4 + §6 的 feature-flag 都要再加一層 tenant 維度。

---

## 6. 模組化目標架構（模式 A）

### 6.1 Feature-Flag 機制
沿用現有最強資產 —— `app_settings` 設定系統（AES 加密、30s 快取、稽核、`SECTIONS`/`FIELD_META` 自動生成 UI）。新增：
- **新表 `app_config(key, value, is_public)`（不加密）**：放 feature flag（`features.subscriptions=true`…）+ 品牌設定（`brand.name/primary_color/logo_url/site_url`）。flag 跟品牌不是機密，不該塞進加密的密鑰表。
- **公開端點 `GET /config`**：只回 `is_public` 的 row，給**前台**讀（前台目前完全沒有讀設定的管道，這是新增的）。

### 6.2 三個咽喉點依 flag 開關
1. **API 路由掛載**（`app.ts`）：依 flag 決定掛不掛該 router。
2. **選單**：後台 `NAV_ITEMS`、前台 `NAV_LINKS`、結帳 `PAYMENT_OPTIONS`/物流選項 → 從靜態陣列改成讀 flag。
3. **Worker 註冊**（`worker.ts`）：依 flag 決定啟不啟動該 scheduler。

### 6.3 解耦兩大 hub
- **`enqueue-post-payment.ts` → 事件總線**：付款成功發 `order.paid` 事件，各模組（點數/發票/物流/通知/升等）訂閱；關掉的模組不訂閱。
- **`orders.ts` 折扣鏈 → 外掛鏈**：等級/活動/優惠券/點數各自是一個 discount plugin，依 flag 組裝；金流改 **gateway registry**（不再 `if/else`）。

### 6.4 品牌設定（解決寫死 660 處）
- 顏色：收斂到 `globals.css` 既有的 `--primary` 等 CSS 變數，由 `brand.primary_color` 餵入（目前 494 處 inline `#10305a` 要清掉）。
- Logo/名稱/SEO/Email 模板/Footer：改讀 `brand.*`。

### 6.5 佈建流程（勾選 → 生成）
客戶在一個佈建介面勾功能 + 填品牌 → 系統：(1) 開新 Supabase/Railway/Vercel（或用既有空殼）→ (2) 跑 schema（**含 0036 RLS**）+ 依勾選做條件式 seed → (3) 寫入 `app_config` 的 flag + 品牌 → (4) 設定 per-client 密鑰 + CORS/網域。

---

## 7. 分階段路線圖

> 原則：**安全先行**，每階段獨立可驗證、可交付。Phase 0 是現在進行式。

### Phase 0 — 安全急救（進行中）
- [x] 0036 RLS migration 寫好 + commit。
- [ ] **使用者執行 0036**（線上外洩關閉前最高優先）。
- [ ] 修 §4.3 的 P1（variants 庫存權限、pchomepay 金額比對）。

### Phase 1 — 程式碼整備（可賣品質 / 好交接）
- 抽共用 `money` 模組（`centsToTwd`/`twdToCents` + 前台 `formatTwd`），取代 ~40 + ~131 處 inline。
- 前台 API 存取統一：一個 `getServerToken()`、統一走 `apiClient`/`adminFetch`、收斂 `RAILWAY_API_URL`/`NEXT_PUBLIC_API_URL` 成一個。
- 補金流/webhook/post-payment 測試（目前零覆蓋）。
- `.error` 靜默掃除（adjustPoints、批次取消、linepay capture）+ 加 CI gate。
- 統一 API 回應格式（錯誤不外洩 `error.message`）。

### Phase 2 — Feature-Flag 基礎 + 品牌設定
- 建 `app_config` 表 + `GET /config` + 前台設定 client。
- 三個咽喉點改 flag 驅動。
- 品牌設定收斂（CSS 變數 + `brand.*`）。

### Phase 3 — 解耦
- post-payment 事件總線。
- 折扣外掛鏈 + 金流 registry。
- 拆會員/點數/活動/優惠券 lib 交叉依賴。

### Phase 4 — 佈建自動化
- schema migration runner（取代手動貼 SQL）+ 條件式 seed。
- per-client 密鑰/CORS/網域 env 化。
- 佈建介面（勾選功能 → 生成）。

---

## 8. 交接指南（給未來 Agent）

- **部署**：見 [DEPLOYMENT.md](../DEPLOYMENT.md)。API/worker 推 `main` 自動部署；web 推 Vercel；**schema 改動要手動貼進 Supabase SQL Editor**。
- **新增/改 schema**：寫 migration 檔到 `packages/db/migrations/`（流水號）+ **把 SQL 交給使用者手動跑**（不會自動套用）。
- **新增可設定項**：加 key 到 `settings.ts` 的 `ALLOWED_KEYS`/`SECTIONS`/`SECRET_KEYS`（機密才放 SECRET_KEYS）+ 前端 `FIELD_META`，UI 會自動長出來。
- **金流/物流**：ECPay 串接見 `lib/ecpay-logistics.ts` + `logistics.ts`；CheckMacValue 已集中在 `buildCheckMacValue`。超商取貨付款（COD）流程：選店 → 建單(代收金額=訂單總額) → 後台列印寄件單 → 到店寄件 → 取貨付款 → webhook 確認。
- **關鍵檔案地圖**：`routes/orders.ts`（下單/折扣/金流）、`lib/enqueue-post-payment.ts`（付款後流程）、`routes/admin-orders.ts`（取消/退款/刪除）、`lib/settings.ts`（設定系統）、`lib/tier.ts`+`lib/points.ts`（會員/點數）、`webhooks/*`（金流回呼）。
- **陷阱**：Supabase 靜默錯誤、金額單位 cents↔TWD、service-role vs RLS、`node_modules` 在 repo root。

---

## 附錄：本文件來源
本規格由 2026-06-12 一次四面向平行體檢彙整：模組/耦合圖、安全與金流完整性、程式碼品質、白標就緒度。後續改動請同步更新本文件對應章節。
