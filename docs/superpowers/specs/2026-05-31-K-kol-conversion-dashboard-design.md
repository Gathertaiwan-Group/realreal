# Spec K — KOL 轉換率 dashboard

**Date:** 2026-05-31
**Status:** Draft (user approved 全做)
**Touches:** apps/api (1 endpoint patch), apps/web (1 admin page patch)
**Scope:** small — ~250 LOC, 0 migration

## Why

Spec I 把 KOL attribution 寫完了（kol_clicks + orders.attributed_kol_id），但 admin 看不到「**點擊 → 訂單轉換率**」。要算這個指標只需 join 既有兩張表 + 一個 dashboard view。

## Locked decisions
- 純 SQL aggregation，無 schema change
- 時段 filter：今日 / 7 日 / 30 日 / 自訂
- 漏斗暫只算「點擊 → 訂單」(無 cart event tracking — 那是 spec L GA 負責)

## Scope

### IN
1. 新 endpoint `GET /admin/kols/:id/conversion?from=&to=` — returns { clicks, orders, conversion_rate, avg_order_value, est_commission, total_revenue, top_products[] }
2. `/admin/kols/[id]/_client.tsx` 加「轉換率」card（4 大數字 + 漏斗條圖 + date range picker）
3. `/admin/kols/page.tsx` list 表加「轉換率」column（用 7 日 default）

### OUT
- 漏斗多層（瀏覽 / 加購 / 結帳 / 完成）— GA4 來提供
- KOL 比較圖（橫向對比 N 個 KOL）— v2
- 匯出 CSV — v2

## Design

### Backend endpoint
```ts
GET /admin/kols/:id/conversion?from=2026-05-01&to=2026-05-31
→ {
  clicks: 1234,              // SELECT COUNT(*) FROM kol_clicks WHERE kol_id=:id AND clicked_at BETWEEN ...
  unique_visitors: 567,      // COUNT(DISTINCT COALESCE(user_id, ip_hash)) 同上條件
  orders: 23,                // SELECT COUNT(*) FROM orders WHERE attributed_kol_id=:id AND created_at BETWEEN ...
  conversion_rate: 1.86,     // orders / clicks * 100
  total_revenue: 45600,      // SELECT SUM(total) ...
  avg_order_value: 1983,     // total_revenue / orders
  est_commission: 4560,      // total_revenue * commission_rate / 100
  top_products: [            // top 5 products this KOL brought
    { product_id, name, qty_sold, revenue }
  ]
}
```

Default range = last 30 days if no params.

### Frontend
`/admin/kols/[id]/_client.tsx` 加新 card「**轉換率分析**」放在 stats card 下方：
- 上方 4 個 KPI tile：點擊 / 訂單 / 轉換率 % (大字、color 標) / 業績 NT$
- 中間漏斗：簡單 2-bar horizontal —「點擊 1,234 ━━━━━━━━」+「訂單 23 ▓」+ 轉換率%
- 下方 top_products list 5 項
- 上方 date range picker：「今日 / 7 日 / 30 日 / 本月 / 自訂」chips；變更時重新 fetch

List page `/admin/kols/page.tsx` 加「7 日轉換率」column — 同 endpoint 用 from=NOW-7d, to=NOW per row（N+1 query；KOL 數量小可接受，>20 時換 batch endpoint）。

## File summary

| 動作 | 路徑 |
|---|---|
| 改 | `apps/api/src/routes/admin-kols.ts` (加 `GET /:id/conversion`) |
| 改 | `apps/web/src/app/admin/kols/[id]/_client.tsx` (加轉換率 card) |
| 改 | `apps/web/src/app/admin/kols/_client.tsx` (list 加 column) |

## Validation
1. Smoke：mock 一個 KOL 帶 10 個 kol_clicks + 2 個 attributed orders → dashboard 應顯示 20% 轉換率
2. 空狀態（無 click / order）→ 不 crash，顯示「無資料」
