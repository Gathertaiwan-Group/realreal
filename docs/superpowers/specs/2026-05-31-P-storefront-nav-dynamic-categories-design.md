# Spec P — Storefront nav 「了解產品」+ Footer 商品 column 跟 DB 連動

**Date:** 2026-05-31
**Status:** Implemented
**Touches:** apps/web (4 files), apps/api (0), packages/db (0)
**Scope:** small — ~60 LOC, 0 migration

## Why

User 截圖：storefront top nav 「了解產品 ▾」dropdown 只顯示 2 個 hardcode 項目（植物蛋白粉 / 凍乾水果），而且 slug 是錯的：

```ts
{ href: "/category/protein", label: "植物蛋白粉" },  // ❌ DB 沒 protein slug → 404
{ href: "/category/fruit", label: "凍乾水果" },     // ❌ DB 沒 fruit slug → 404
```

漏掉：永續生活、禮物。  
Footer 同樣 hardcode 同樣錯 slug。

Spec N 把 DB 清乾淨成 4 個正確 slug 後，這個 dropdown 應該自動跟 DB 一致 — 後台改分類 → 5 分鐘內前台 dropdown 自動更新（getCategories cache TTL = 300s）。

## Locked decisions
- **資料來源**：DB via `getCategories()`（既有 helper，App Router fetch cache 300s）
- **fetch 位置**：RootLayout server component（一次 query 給整站，hit cache 後 0 cost）
- **0 商品分類**：**隱藏**（user 選；禮物現在 0 商品就先不顯示，上禮盒商品後自動冒出來）
- **排序**：`sort_order` ASC
- **「全部商品」link**：Footer 保留（spec N 已 normalize 為走 `/shop` URL）
- **「了解產品」本身點得進去**：維持，連到 `/shop`

## Scope

### IN
1. `apps/web/src/app/layout.tsx` — 改 async + 一次 `await getCategories()` 傳給 StorefrontShell
2. `apps/web/src/components/layout/StorefrontShell.tsx` — 加 `categories` prop，forward 給 Header + Footer
3. `apps/web/src/components/layout/Header.tsx` — 接 `categories` prop，`useMemo` 算 dynamic `NAV_LINKS`（「了解產品」children = filter + sort categories）
4. `apps/web/src/components/layout/Footer.tsx` — 同 Header pattern，「商品」column 的 links dynamic

### OUT
- Skeleton / loading state（reverence Layout 都 server-render，沒 client-side loading）
- 多語系 category 名稱 (未來)
- Featured-only filter（v1 用 `product_count > 0` 自然過濾）

## Design

### Data flow

```
layout.tsx (server)
  → await getCategories()         ← cached 300s by getCategories()
    → <StorefrontShell categories={...}>
       (client component, hides on /admin path)
       → <Header categories={...}>
          → useMemo: filter slug !== 'all' + product_count > 0 → sort by sort_order
            → render dropdown children
       → <Footer categories={...}>
          → same filter/sort logic
            → render 商品 column links + [全部商品]
```

### Filter rule (shared Header + Footer)
```ts
categories
  .filter(c => c.slug !== "all")           // exclude WooCommerce legacy
  .filter(c => (c.product_count ?? 0) > 0) // hide empty (user choice)
  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  .map(c => ({ href: `/category/${c.slug}`, label: c.name }))
```

`product_count` 由 `/categories` API 補上（既有；admin 分類頁也用同欄位）。

### 預期最終 dropdown (post spec N)

```
了解產品 ▾
  ├ 植物高蛋白粉   → /category/plant-based-powder   (21 商品)
  ├ 凍乾水果      → /category/freeze-dried          (7 商品)
  └ 永續生活      → /category/sustain-life          (3 商品)
  (禮物 隱藏，因 0 商品)
```

未來上禮盒商品 → 5 min 內前台自動多 1 項。

## File summary

| 動作 | 路徑 | LOC |
|---|---|---|
| 改 | `apps/web/src/app/layout.tsx` (+import + async + await) | +5 |
| 改 | `apps/web/src/components/layout/StorefrontShell.tsx` (+prop + forward) | +5 |
| 改 | `apps/web/src/components/layout/Header.tsx` (useMemo + accept prop) | +20 / -10 |
| 改 | `apps/web/src/components/layout/Footer.tsx` (accept prop + move FOOTER_LINKS inside fn) | +15 / -8 |

預估 ~60 LOC / 0 migration

## Validation

- ✅ `npx tsc --noEmit` clean
- 前台 `/` 頂端 dropdown 顯示 3 項（植物高蛋白粉、凍乾水果、永續生活），點任一進對應 `/category/<slug>` 看商品
- 前台 footer「商品」column 顯示同 3 項 + 「全部商品」
- `/admin` 頁不 render Header/Footer（既有 logic 保留）

## Risks
- `getCategories()` 失敗 → 回空陣列 → dropdown 變只有「了解產品」單一 link 無 children → 結構 OK 不 crash
- 後台改 slug → 5 分鐘 cache window 內舊 link 短暫 404（acceptable）
- Mobile nav 用同樣 NAV_LINKS 結構（既有 render loop），自動跟 desktop 同步
