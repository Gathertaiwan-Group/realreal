# 加購區功能設計 (Addon Strip)

Date: 2026-05-31

## 目標

在商品購物頁和購物車中加入加購區，讓消費者在結帳流程中方便加購其他商品，提升客單價。

## 決策摘要

| 決策項目 | 選擇 |
|---------|------|
| 加購清單管理 | 後台商品頁勾選 `is_addon` 標籤，無設定時 fallback 暢銷商品 |
| 商品頁位置 | 「加入購物車」按鈕下方 |
| 購物車位置 | CartDrawer 內，優先 `is_addon` 商品 |
| 加購定價 | 原價，無特殊折扣 |
| 排序 | 無自訂排序（未來可加 `addon_order` 欄位） |

## 資料層

### DB Migration

```sql
ALTER TABLE products ADD COLUMN is_addon boolean NOT NULL DEFAULT false;
CREATE INDEX ON products(is_addon) WHERE is_addon = true;
```

## API 層

### `GET /products` 新增參數

- `is_addon=true` — 篩選已標記加購商品
- 若結果為 0，自動 fallback `sort=best_selling`
- 商品頁：排除當前商品（`exclude_slug` 參數）
- 購物車：排除購物車內已有的商品（前端 filter）

## 前端元件

### `AddonStrip` 元件（新建）

```
位置: apps/web/src/components/product/AddonStrip.tsx
     apps/web/src/components/cart/AddonStrip.tsx (或共用)
```

規格：
- 水平橫向捲動（`overflow-x-auto`）
- 每張卡：商品圖 64px × 64px、名稱（最多 2 行）、原價、「＋ 加入」按鈕
- 商品頁最多 6 個，購物車最多 4 個
- 加入時用 `useCart().addItem()`，同現有邏輯

### 商品詳情頁整合

```
檔案: apps/web/src/components/product/AddToCartSection.tsx
位置: 「加入購物車」按鈕下方
```

### 購物車 Drawer 整合

```
檔案: apps/web/src/components/cart/CartDrawer.tsx
位置: 取代或增強現有 RecommendationStrip
邏輯: is_addon 商品優先，fallback best_selling，排除購物車已有商品
```

### 後台商品編輯頁

```
檔案: apps/web/src/app/admin/products/[id]/page.tsx (或 _client.tsx)
新增: Toggle「設為加購商品」→ 更新 is_addon 欄位
```

## 實作順序

1. DB migration + API filter
2. 後台商品編輯 toggle
3. `AddonStrip` 元件
4. 商品頁整合
5. 購物車 Drawer 整合
