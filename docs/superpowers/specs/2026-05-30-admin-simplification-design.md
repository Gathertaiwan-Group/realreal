# Admin 後台 7 項瘦身 + 團隊 CRUD + 優惠券/行銷合併 — 設計

**日期**：2026-05-30
**範疇**：`apps/web/src/app/admin/*` + 一個小 API（team CRUD）
**策略**：使用者選定 C（推薦），sidebar 從 14 → 7 項

---

## 問題

現況 sidebar 14 項：
```
概覽 / 訂單 / 商品 / 客戶 / 訂閱 / 發票(刪) / 優惠券 /
評價 / 行銷 / 數據 / 文章 / 團隊 / Email 模板 / 系統設定
```

太多。Shopify / Notion / Linear 都是 5-8 項。

## 解法 — C 策略

```
概覽
訂單   ← 含「訂閱」tab
商品   ← 含「評價」tab
客戶
行銷   ← 含「優惠券」+ 「行銷活動」 tab
文章
設定   ← 含「金流/物流/發票」+「Email 模板」+「團隊成員」 tab
```

加上「概覽」首頁吞掉「數據分析」（首頁卡片+進細頁連結，但用戶大部分時間概覽就夠）。

---

## 重點變更

### 1. 側邊欄 reorder
`apps/web/src/app/admin/layout.tsx`：NAV_ITEMS 改 7 項。

### 2. 訂單 + 訂閱 合併到 `/admin/orders`
- 加 tab UI：訂單 (default) | 訂閱
- 「訂閱」tab 直接 render 原本 `/admin/subscriptions/page.tsx` 的內容
- `/admin/subscriptions` route 保留變 redirect 到 `/admin/orders?tab=subscriptions`

### 3. 商品 + 評價 合併到 `/admin/products`
- 加 tab：商品列表 (default) | 評價
- 評價 tab render 原本 `/admin/reviews` 內容
- `/admin/reviews` 變 redirect 到 `/admin/products?tab=reviews`

### 4. 優惠券 + 行銷活動 合併到 `/admin/marketing`
- 新建路由 `apps/web/src/app/admin/marketing/page.tsx`
- 加 tab：行銷活動 (default) | 優惠券
- 行銷活動 tab render 原本 `/admin/campaigns` 內容
- 優惠券 tab render 原本 `/admin/coupons` 內容
- `/admin/campaigns` 和 `/admin/coupons` 變 redirect

### 5. 系統設定 + 團隊 + Email 模板 合併到 `/admin/settings`
- 現有 `/admin/settings` 已有 6 區（金流/物流/發票/通知 + 之前的）
- 加 tab：系統參數 (default) | 團隊成員 | Email 模板
  - 系統參數 = 現在的 accordion
  - 團隊成員 tab = 新功能（CRUD，下方）
  - Email 模板 tab = 原本 `/admin/email-templates` 內容
- `/admin/email-templates` + `/admin/users`（既有的團隊管理）變 redirect

### 6. 「數據分析」吃進「概覽」
- `/admin/page.tsx` 改成包含主要圖表
- `/admin/analytics` 保留為「進階數據」深層頁，從概覽連過去
- Sidebar **拿掉**「數據分析」項目

---

## 團隊 CRUD 細節

### UX
位置：`/admin/settings` → 「團隊成員」tab

```
┌─────────────────────────────────────────────────────┐
│ 團隊成員                          [新增成員] (admin) │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐    │
│ │ 名稱        Email                角色  操作 │    │
│ ├─────────────────────────────────────────────┤    │
│ │ Admin       gathertaiwan@…       admin  ─  │    │
│ │ 誠真生活    armand7951@…         editor ↓  │ ← role dropdown
│ │ Joe         joe@example.com      editor ✕  │ ← demote=delete
│ └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 新增成員 flow
- 點「新增成員」開 modal
- 輸入 email
- 後端查找：
  - email 已存在於 `auth.users` → 升等該 user 的 `user_profiles.role`
  - email 不在 `auth.users` → 拒絕 + 提示「該 email 尚未註冊，請對方先註冊帳號」
- 選擇角色：admin / editor
- 確認

### 刪除成員（= 降級）
- 點 ✕ → confirm dialog「將降級為一般用戶，仍可購物但失去後台權限」
- 後端：`user_profiles.role = 'viewer'`
- 不真的刪 auth.users（保留歷史訂單關聯）

### 安全
- 防自我降級：當前用戶不能改自己的 role
- 至少留 1 個 admin：UI 端 + 後端都檢查，最後一個 admin 不能降級

### API（新）
`apps/api/src/routes/admin-team.ts`：

```
GET    /admin/team           列出所有 role !== 'viewer' 的 user_profiles + email
POST   /admin/team           { email, role }  — 升等已存在用戶
PATCH  /admin/team/:userId   { role }         — 變更角色
DELETE /admin/team/:userId   — 等同 PATCH role=viewer（軟刪除）
```

---

## 優惠券 + 行銷活動 合併細節

新路由 `/admin/marketing`：
- URL: `?tab=campaigns` (default) or `?tab=coupons`
- Tabs 用既有的 simple tab pattern（沒裝 shadcn tabs，自己刻 button + 條件 render）
- 內部不重寫邏輯 — 把既有 `/admin/campaigns/page.tsx` 和 `/admin/coupons/page.tsx` 的內容**搬進** marketing 的對應 tab section

子路由保留：
- `/admin/campaigns/[id]` 不動（編輯個別活動的深層頁）
- `/admin/coupons/[id]` 同上

但 `/admin/campaigns/` 和 `/admin/coupons/` 的根 `page.tsx` 變 redirect 到 `/admin/marketing?tab=...`

---

## 路由變動 summary

| 路由 | 動作 |
|---|---|
| `/admin/page.tsx` | 概覽吸收 analytics 主要圖表 |
| `/admin/orders/page.tsx` | 加 tab（訂單/訂閱） |
| `/admin/subscriptions/page.tsx` | redirect to `/admin/orders?tab=subscriptions` |
| `/admin/products/page.tsx` | 加 tab（商品/評價） |
| `/admin/reviews/page.tsx` | redirect to `/admin/products?tab=reviews` |
| `/admin/marketing/page.tsx` | **新建** — tabs（活動/優惠券） |
| `/admin/campaigns/page.tsx` | redirect to `/admin/marketing?tab=campaigns` |
| `/admin/coupons/page.tsx` | redirect to `/admin/marketing?tab=coupons` |
| `/admin/settings/page.tsx` | 加 tabs（系統參數/團隊/Email 模板）並整合既有 settings UI |
| `/admin/email-templates/page.tsx` | redirect to `/admin/settings?tab=email-templates` |
| `/admin/users/page.tsx` | redirect to `/admin/settings?tab=team` |
| `/admin/analytics/page.tsx` | 保留（深層數據） |

---

## API 變動

**新：**
- `apps/api/src/routes/admin-team.ts` — GET/POST/PATCH/DELETE for team CRUD
- mount on `/admin/team`

**不動：**
- 既有 admin endpoints（orders / invoices / settings 等都不變）

---

## 元件分工

新建：
- `apps/web/src/app/admin/_components/Tabs.tsx` — 簡單的 tabs UI（用 search params 切換）
- `apps/web/src/app/admin/marketing/page.tsx` — 行銷總頁
- `apps/web/src/app/admin/settings/_components/TeamTab.tsx` — 團隊 CRUD client component
- `apps/web/src/app/admin/settings/_components/EmailTemplatesTab.tsx` — Email 模板 tab

改：
- `apps/web/src/app/admin/layout.tsx` — NAV_ITEMS 從 14 → 7
- `apps/web/src/app/admin/page.tsx` — 加入 analytics 主圖表
- `apps/web/src/app/admin/orders/page.tsx` — 加 tab + 訂閱 section
- `apps/web/src/app/admin/products/page.tsx` — 加 tab + 評價 section
- `apps/web/src/app/admin/settings/page.tsx` — 包現有 settings + 加 team / email tabs

Redirect stubs：
- `/admin/subscriptions/page.tsx`
- `/admin/reviews/page.tsx`
- `/admin/campaigns/page.tsx`
- `/admin/coupons/page.tsx`
- `/admin/email-templates/page.tsx`
- `/admin/users/page.tsx`

---

## 不做（YAGNI）

- 不重做任何子頁面內部 UI（評價列表、優惠券編輯、訂閱詳情… 內容都不動）
- 不做 tab 動畫/過渡
- 不做頂部 search bar（先觀察是否需要）
- 不做角色細分（admin / editor / viewer 三級就好）
- 不做團隊邀請 email（要求對方先註冊，再升等）

---

## 驗證

1. Sidebar 顯示 7 項
2. 訂單頁切到「訂閱」tab → 看到原本訂閱管理畫面
3. 商品頁切到「評價」tab → 看到原本評價管理畫面
4. 行銷頁兩個 tab 切換正常
5. 設定頁切到「團隊成員」tab：
   - 列表顯示現有 admin/editor
   - 新增成員（必須是已註冊用戶）
   - 改 role
   - 軟刪除（降 viewer）
   - 自己無法改自己 role
   - 最後一個 admin 無法降級
6. 設定頁切到「Email 模板」tab → 看到原 email-templates 編輯器
7. 舊路由全部 redirect 不會 404
8. 概覽頁有銷售圖 + 進階分析連結
