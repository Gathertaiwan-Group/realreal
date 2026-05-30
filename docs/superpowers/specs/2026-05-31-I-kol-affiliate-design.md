# Spec I — KOL / 聯盟行銷連結 + 7 天 attribution + 佣金計算

**Date:** 2026-05-31
**Status:** Draft → user approved 4 architectural decisions
**Touches:** packages/db (1 migration), apps/api (3 new routes + 1 lib + 1 middleware-tier modify), apps/web (1 middleware + 1 new landing page + 2 new admin pages + 1 checkout patch)
**Scope:** medium-large — ~1200 LOC

## Why

User wants：「跟我合作的 KOL 有專屬下單連結 + 粉絲透過連結享他的專屬折扣 + 我能看每個 KOL 帶了多少業績、付多少佣金」。

現況：**零**聯盟行銷 / referral / KOL 系統。
- grep `affiliate / kol / referral / commission / ref_code` 全 codebase → 0 hits
- 沒人 parse ?ref= URL param
- coupons 表雖有但無 「auto-apply via referral」概念

## Locked decisions (with user 2026-05-31)
1. **URL 格式**：合一 — `/k/<slug>` 有 KOL landing 頁；同時 `?ref=<slug>` 在任何頁面都能 attribute
2. **折扣機制**：搭既有 coupons 表 — KOL row 用 `coupon_id` 連到一張專屬 coupon；?ref/路徑進來的顧客自動套用
3. **Attribution window**：7 天 cookie；點 KOL link → cookie kol_ref=<slug> + kol_ref_set_at=now，7 天內下單算這個 KOL
4. **Commission**：每 KOL 存 `commission_rate`（0~100% NUMERIC），系統自動算「本期應付」(SUM(orders.total) × rate)；admin 月底 dashboard 看數字、手動撥款

## Scope

### IN
1. Migration 0023 — `kols` 表 + `orders.attributed_kol_id` 欄
2. `GET /kols/:slug` (public) + `POST /kols/track-click` (public, optional analytics)
3. `routes/admin-kols.ts` 完整 CRUD + stats endpoint
4. Next.js `middleware.ts` 增加 `?ref=` 攔截 → 設 cookie 7 天
5. `apps/web/src/app/k/[slug]/page.tsx` — KOL landing 頁
6. checkout (`apps/api/src/routes/orders.ts`) 讀 cookie kol_ref → 找 KOL → 自動套 coupon + 寫 `orders.attributed_kol_id`
7. `/admin/kols/page.tsx` + `_client.tsx` — KOL list (含 stats summary 欄)
8. `/admin/kols/[id]/page.tsx` + `_client.tsx` — KOL detail (基本資料 + 連結 + commission stats + 該 KOL 帶來的訂單列表)
9. Sidebar nav 加「聯盟行銷」項目

### OUT
- KOL 自助登入後台看自己的 stats（v1 純 admin 端）
- 多級分潤（KOL 推 KOL）
- 連結縮網址 / shortlink
- Commission 自動扣款（仍是 admin 手動匯款）
- A/B test 不同 coupon for same KOL
- 連結點擊熱度圖
- 退款後 commission 回扣（v1 退款後 commission 不自動扣回，admin 手動核帳）

## Design

### Section 1 — Migration 0023

`packages/db/migrations/0023_kol_affiliate.sql`:
```sql
CREATE TABLE IF NOT EXISTS kols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  instagram_handle TEXT,
  youtube_handle TEXT,
  tiktok_handle TEXT,
  coupon_id UUID REFERENCES coupons(id),
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10,  -- e.g. 10 = 10%
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,                                         -- admin 內部備註
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kols_slug ON kols(slug);
CREATE INDEX IF NOT EXISTS idx_kols_active ON kols(is_active);

-- attribution on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS attributed_kol_id UUID REFERENCES kols(id),
  ADD COLUMN IF NOT EXISTS attributed_kol_slug TEXT;   -- 冗餘：避免 KOL 刪除後 audit 斷裂

CREATE INDEX IF NOT EXISTS idx_orders_kol ON orders(attributed_kol_id);

-- (optional) click tracking for analytics; can skip if YAGNI
CREATE TABLE IF NOT EXISTS kol_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kol_id UUID NOT NULL REFERENCES kols(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),  -- NULL for guests
  ip_hash TEXT,                            -- hash of IP (privacy)
  user_agent TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kol_clicks_kol ON kol_clicks(kol_id, clicked_at DESC);
```

### Section 2 — Backend API

`apps/api/src/routes/kols.ts` (public):
- `GET /kols/:slug` — return active KOL by slug (name, avatar, bio, socials, coupon code/discount); 404 if inactive/missing
- `POST /kols/track-click` body { slug, path } — insert kol_clicks row (fire-and-forget; rate-limit to avoid spam)

`apps/api/src/routes/admin-kols.ts` (requireAuth + requireAdmin):
- `GET /admin/kols` — list with stats join: order_count, total_revenue, est_commission (SUM(orders.total) * rate / 100)
- `GET /admin/kols/:id` — detail incl. recent 50 attributed orders
- `POST /admin/kols` — create
- `PUT /admin/kols/:id` — update
- `DELETE /admin/kols/:id` — soft delete (set is_active=false; keep audit). Hard delete if no orders.
- `GET /admin/kols/:id/stats?from=&to=` — date-range stats for commission settlement

zod schemas: slug 自動 lowercase + trim + regex 驗；commission_rate 0~100。

### Section 3 — `orders.ts` checkout integration

Read cookie `kol_ref` from request headers. If set:
1. `SELECT * FROM kols WHERE slug = ? AND is_active = true`
2. If KOL has coupon_id: auto-apply that coupon (override or merge with user's typed coupon — **decision: KOL coupon takes priority** unless user explicitly typed another that's more aggressive)
3. Write `orders.attributed_kol_id = kol.id`, `attributed_kol_slug = kol.slug`
4. Also clear cookie if order success (one-shot) — optional decision; we keep for repeat orders within 7-day window

`enqueue-post-payment.ts` 不動 — commission 不在訂單事件中即時計算，admin 看 dashboard 才 SUM。

### Section 4 — Next.js middleware (apps/web/middleware.ts)

If existing middleware exists, extend. Otherwise create:
```ts
import { NextResponse, NextRequest } from "next/server"

export function middleware(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref")
  const res = NextResponse.next()
  if (ref && /^[a-z0-9-]+$/.test(ref)) {
    res.cookies.set("kol_ref", ref, {
      maxAge: 60 * 60 * 24 * 7,  // 7 days
      sameSite: "lax",
      httpOnly: false,  // false so client JS can read for landing page UX
      secure: true,
      path: "/",
    })
    res.cookies.set("kol_ref_set_at", new Date().toISOString(), {
      maxAge: 60 * 60 * 24 * 7,
      sameSite: "lax",
      httpOnly: false,
      secure: true,
      path: "/",
    })
  }
  return res
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon|api).*)"],
}
```

If existing middleware does auth: merge logic (kol_ref capture first, then auth).

### Section 5 — KOL landing page

`apps/web/src/app/k/[slug]/page.tsx` (server):
- Fetch GET /kols/:slug (server-side)
- 404 if not found
- Hero block: avatar (large round) + name + bio + socials (icons → IG/YT/TikTok handle links)
- "你已啟用 KOL X 的專屬折扣，全站結帳自動套用 N% off" banner (green)
- Recommended products section: 顯示 KOL 的 featured products (v1 簡單顯示 is_featured=true 商品；v2 可加 kols.recommended_product_ids[])
- Background: subtle brand colors

`apps/web/src/app/k/[slug]/_client.tsx`:
- On mount: POST /kols/track-click { slug, path: "/k/" + slug } (fire-and-forget)

### Section 6 — Admin UI

`/admin/kols/page.tsx` — list:
- Table: avatar / name / slug / coupon code / commission % / 訂單數 / 業績 / 估算佣金 / 啟用狀態
- 「+ 新增 KOL」按鈕

`/admin/kols/[id]/page.tsx` — detail:
- 編輯區：name / bio / avatar URL / socials / commission_rate / 連 coupon_id (CouponPicker 新組件) / is_active toggle
- Stats card：本月訂單 / 本月業績 / 本月估算佣金（可選日期範圍）
- 訂單列表：最近 50 筆 attributed orders（連結到 /admin/orders/<id>）
- Copy link button：複製 `https://realreal.cc/k/<slug>` 和 `https://realreal.cc/?ref=<slug>`

CouponPicker 元件（類似 spec E pickers）— /admin/kols/[id] 用，從 GET /admin/coupons 拉。

### Section 7 — Sidebar nav

`apps/web/src/app/admin/layout.tsx` NAV_ITEMS 加：
```ts
{ href: "/admin/kols", label: "聯盟行銷", icon: Share2, roles: ["admin"] }
```
（位置：建議在「行銷」項目下方）

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0023_kol_affiliate.sql` |
| 新 | `apps/api/src/routes/kols.ts` (public) |
| 新 | `apps/api/src/routes/admin-kols.ts` (admin CRUD + stats) |
| 改 | `apps/api/src/app.ts` (mount 2 new routers) |
| 改 | `apps/api/src/routes/orders.ts` (讀 cookie + auto-apply coupon + 寫 attributed_kol_id) |
| 新/改 | `apps/web/middleware.ts` (capture ?ref → cookie) |
| 新 | `apps/web/src/app/k/[slug]/page.tsx` + `_client.tsx` |
| 新 | `apps/web/src/app/admin/kols/page.tsx` + `_client.tsx` |
| 新 | `apps/web/src/app/admin/kols/[id]/page.tsx` + `_client.tsx` + `actions.ts` |
| 新 | `apps/web/src/app/admin/kols/CouponPicker.tsx` |
| 改 | `apps/web/src/app/admin/layout.tsx` (sidebar nav) |

預估 ~1200 LOC 新增 / ~50 LOC 修改 / 1 migration

## Validation

1. `tsc` / `next build` / `npm test` 雙綠
2. Migration 0023 套用 verify：kols + orders.attributed_kol_id + kol_clicks 都存在
3. Smoke：
   - admin 在 /admin/kols 建 KOL 「test_kol」+ link 到既有 coupon code「SUMMER10」(10% off)
   - 訪客打 https://realreal-store.vercel.app/?ref=test_kol → 應 set cookie kol_ref=test_kol
   - 加任一商品到 cart → 結帳時看到「KOL test_kol 專屬折扣 -10%」自動套用
   - 完成下單 → DB query orders 最新 row：`attributed_kol_id` 已填、coupon_id 也已填 (SUMMER10)
   - admin 進 /admin/kols/<id> → 「本月業績」應顯示這筆訂單金額、估算佣金 = total * commission_rate / 100
4. 直接打 https://realreal-store.vercel.app/k/test_kol → KOL landing 頁顯示

## Known caveats

- KOL coupon 撞單：如果顧客自己 typed 一張更便宜的 coupon，目前 spec 是「KOL 優先」(可能讓顧客付更多)。若日後要改「兩者取較佳」需要在 orders.ts 加 max 比較。
- IP hash 為 SHA-256 of IP + 一個 server-side salt（在 lib/kol.ts 內 hardcode salt 或從 env 拉）。隱私考量。
- 退款 / 取消訂單 後 commission 不自動扣回，需 admin dashboard 手動核帳。Spec 標 OUT。
- KOL 刪除 (hard) 會 cascade kol_clicks，但 orders.attributed_kol_id 設 FK NULL；保留 attributed_kol_slug 文字當 audit trail。
- Cookie 是 client-readable (httpOnly: false) 讓前端能在 KOL landing 頁顯示「你已啟用 KOL X 折扣」hint UX；無安全敏感資訊。
- Middleware matcher exclude `/api`, `_next/*`, `favicon` — 避免攔截 API 與 asset 請求拖效能。
