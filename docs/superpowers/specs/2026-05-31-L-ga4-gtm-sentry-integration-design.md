# Spec L — GA4 + GTM + Sentry 整合

**Date:** 2026-05-31
**Status:** Draft (user approved 全做)
**Touches:** apps/web (1 layout patch + 1 new Analytics component + 1 sentry config), apps/api (sentry init), packages/db (0)
**Scope:** medium — ~500 LOC, 0 migration

## Why

零 analytics + 零 error monitoring 現狀：
- 不知道每日 PV / 流量來源 / 顧客行為
- 線上 bug 都是「使用者來信你才知道」(無 Sentry)
- KOL 轉換需要 GA4 來補漏斗深度（瀏覽/加購/結帳/完成）

加 GA4（流量分析）+ GTM（容器化管理腳本）+ Sentry（錯誤監控）三件套是業界標準起手式。

## Locked decisions
- GA4 走 GTM 容器（不直接裝 gtag.js），未來再加 Pixel / Clarity 也都進 GTM
- ID 全部存 `app_settings` (admin 可調) + `NEXT_PUBLIC_*` env 雙軌（env override admin setting，方便不同環境）
- Sentry 客戶端+伺服器端兩邊都接（@sentry/nextjs for web、@sentry/node for api）
- Source maps 上傳到 Sentry（debug 線上錯誤可看原 TS code）
- 顧客端 PII 不送 Sentry（auto-scrub email/IP）

## Scope

### IN
1. 安裝 `@sentry/nextjs` (apps/web) + `@sentry/node` (apps/api)
2. Sentry config files (sentry.client.config.ts / sentry.server.config.ts / sentry.edge.config.ts) — DSN 從 env 拉
3. `apps/web/src/components/Analytics.tsx` — 注入 GTM script (head 部分) + dataLayer 初始化
4. layout.tsx 載入 `<Analytics />` (僅 production)
5. Server actions / API routes 全部包 try/catch + Sentry.captureException
6. checkout 完成 → fire GA4 `purchase` event via dataLayer.push (含 transaction_id, value, currency, items, kol_slug)
7. KOL 連結進站 → fire `view_promotion` event (kol_slug, promotion_id)
8. /admin/settings 加 analytics section：4 個 input (GA4 measurement ID / GTM container ID / Sentry DSN web / Sentry DSN api)
9. 安裝後 NEXT_PUBLIC_GTM_ID / NEXT_PUBLIC_SENTRY_DSN_WEB 加 Vercel env；SENTRY_DSN_API 加 Railway env

### OUT
- A/B test platform (Optimizely / Google Optimize sunset)
- Server-side GA4 measurement protocol（純客戶端發送足夠 v1）
- 自動 Sentry alert → Slack（v1 看 Sentry dashboard 即可；spec M 補 LINE Notify）

## Design

### Section 1 — GTM 設定 (`apps/web/src/components/Analytics.tsx`)

```tsx
"use client"
import Script from "next/script"

export function Analytics() {
  const gtmId = process.env.NEXT_PUBLIC_GTM_ID
  if (!gtmId || process.env.NODE_ENV !== "production") return null
  return (
    <>
      <Script id="gtm-base" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: `
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${gtmId}');
      ` }} />
      <noscript dangerouslySetInnerHTML={{ __html: `
        <iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}"
        height="0" width="0" style="display:none;visibility:hidden"></iframe>
      ` }} />
    </>
  )
}
```

Mount in `layout.tsx` <head> via Next.js Script.

### Section 2 — `lib/analytics.ts` event helpers

```ts
// apps/web/src/lib/analytics.ts
export function trackPurchase(order: { id, total, items, kol_slug? }) {
  if (typeof window === "undefined") return
  ;(window as any).dataLayer?.push({
    event: "purchase",
    ecommerce: {
      transaction_id: order.id,
      value: order.total,
      currency: "TWD",
      items: order.items.map(i => ({ item_id: i.sku, item_name: i.name, price: i.unit_price, quantity: i.qty })),
      affiliation: order.kol_slug ? `kol:${order.kol_slug}` : undefined,
    },
  })
}

export function trackKolView(kolSlug: string) {
  if (typeof window === "undefined") return
  ;(window as any).dataLayer?.push({
    event: "view_promotion",
    promotion_id: `kol:${kolSlug}`,
    promotion_name: kolSlug,
  })
}

export function trackAddToCart(item: { sku, name, price, qty }) { /* ... */ }
export function trackBeginCheckout(cart: { items, total }) { /* ... */ }
```

Call sites:
- `/checkout/success` (after payment success) → `trackPurchase`
- `/k/[slug]/_client.tsx` mount → `trackKolView`
- `/shop/[slug]` 「加入購物車」 → `trackAddToCart`
- `/checkout/payment` 進頁面 → `trackBeginCheckout`

### Section 3 — Sentry

`apps/web/sentry.client.config.ts`:
```ts
import * as Sentry from "@sentry/nextjs"
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0.0,
  replaysOnErrorSampleRate: 1.0,
  enabled: process.env.NODE_ENV === "production",
  beforeSend(event) {
    // Scrub PII
    if (event.user) {
      event.user.email = undefined
      event.user.ip_address = undefined
    }
    return event
  },
})
```

Similar `sentry.server.config.ts` + `sentry.edge.config.ts` (no replays for those).

`apps/api/src/sentry.ts`:
```ts
import * as Sentry from "@sentry/node"
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
})
export { Sentry }
```

`apps/api/src/index.ts` 開頭 import sentry first, then wire Express error handler:
```ts
import "./sentry"
import { Sentry } from "./sentry"
// ... after all routes:
app.use(Sentry.expressErrorHandler())
```

### Section 4 — Admin settings UI

`/admin/settings` 加 analytics section（沿用既有 settings card pattern）：
- GA4 Measurement ID `G-XXXXXXXXXX`
- GTM Container ID `GTM-XXXXXX`
- Sentry DSN (Web) `https://xxx@xxx.ingest.sentry.io/xxx`
- Sentry DSN (API) `https://yyy@yyy.ingest.sentry.io/yyy`

Stored as `analytics.ga4_measurement_id / analytics.gtm_id / analytics.sentry_dsn_web / analytics.sentry_dsn_api` in app_settings.

Note: env-based for build-time (`NEXT_PUBLIC_GTM_ID` must be set in Vercel for client-side); admin setting is for documentation/audit only. **改了 env 後須 Vercel re-deploy。**

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `apps/web/src/components/Analytics.tsx` |
| 新 | `apps/web/src/lib/analytics.ts` |
| 改 | `apps/web/src/app/layout.tsx` (mount <Analytics />) |
| 新 | `apps/web/sentry.client.config.ts` |
| 新 | `apps/web/sentry.server.config.ts` |
| 新 | `apps/web/sentry.edge.config.ts` |
| 改 | `apps/web/next.config.ts` (wrap with withSentryConfig) |
| 新 | `apps/api/src/sentry.ts` |
| 改 | `apps/api/src/index.ts` (sentry init + error handler) |
| 改 | `apps/web/src/app/checkout/success/page.tsx` (trackPurchase call) |
| 改 | `apps/web/src/app/k/[slug]/_client.tsx` (trackKolView call) |
| 改 | `apps/web/src/lib/settings.ts` (analytics.* allowed keys) |
| 改 | `apps/web/src/app/admin/settings/page.tsx` (analytics section UI) |
| 改 | `apps/web/package.json` + `apps/api/package.json` (deps) |

預估 ~500 LOC / 0 migration

## Validation
1. `next build` 雙綠
2. 啟用 GTM ID 後刷新前台→DevTools Network 應有 gtm.js + dataLayer global
3. mock 一個下單 → dataLayer.push 有 purchase event payload
4. 故意 throw error in /admin → Sentry dashboard 看得到 issue

## ⚠️ 需要你手動申請後給我 6 個值

| 工具 | 你做 | 拿到後給我 |
|---|---|---|
| **GA4** | 1. analytics.google.com 用 gathertaiwan@gmail.com 登入 2. 開始評估 → 建立帳戶「誠真生活」 → 建立資源「realreal.cc」 3. 收集網站資料 → 拿到 Measurement ID | `G-XXXXXXXXXX` |
| **GTM** | 1. tagmanager.google.com 用同帳號 2. 新帳戶「誠真生活」+ 新容器「realreal.cc」+「Web」3. 拿到 Container ID 4. 在 GTM workspace 設一個 GA4 Configuration tag 連到上面 measurement ID | `GTM-XXXXXX` |
| **GSC** | 1. search.google.com/search-console 用同帳號 2. 加資源「網域」→ realreal.cc 3. 拿 DNS TXT 驗證 record 4. 你的 DNS provider 加 TXT → 回 GSC 驗證 5. 在 GA4 後台連結 GSC（GA 設定 → 產品連結） | DNS TXT 字串 + 驗證後告知我「已通過」（不用拿 ID）|
| **Sentry Web** | 1. sentry.io 註冊 organization「realreal」 2. New project → Next.js → 拿 DSN | `https://xxx@xxx.ingest.sentry.io/xxx` |
| **Sentry API** | 同 sentry.io organization 2. New project → Node.js → 拿 DSN | `https://yyy@yyy.ingest.sentry.io/yyy` |
| **Sentry Auth Token**（source maps 上傳）| 1. Sentry → Settings → Auth Tokens → Create 2. Scopes: project:read + project:releases + org:read | `sntrys_xxxx` |

我把 6 個值貼進 Vercel/Railway env + admin settings UI 就 done。
