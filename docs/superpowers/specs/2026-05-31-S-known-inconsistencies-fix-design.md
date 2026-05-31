# Spec S — 已知前後端漂移 / 一致性問題 6 件總修

**Date:** 2026-05-31
**Status:** Draft (user approved "全做")
**Touches:** apps/api (3 files), apps/web (~10 files), packages/db (1 migration)
**Scope:** medium — ~500 LOC + 1 migration

## Why

我做完 spec R 之後，audit 一輪 codebase 發現 6 個「客戶端 hardcode + 服務端 hardcode + 兩邊數字不一樣」的痛點。客戶會抓到，影響金額顯示一致性、發票開立成功率、品牌呈現。

統一 single-source-of-truth 原則：**所有業務數字進 `app_settings` (admin 可改) 或進共用 lib (lib/order-status.ts 等)；前後端都讀同一份**。

## Locked decisions
- 運費 + 免運門檻：進 `app_settings` 5 key（home fee/cvs fee/home threshold/cvs threshold/cvs threshold scope）+ admin UI 1 個 section + 前後端 helper 各取
- 客服 email：用既有 `app_settings.contact.email` key（若無則新增），3 個前端硬寫處改 fetch
- Order status：抽 `apps/web/src/lib/order-status.ts` STATUS_LABELS + STATUS_VARIANTS 常數
- 統一編號：8 位數字 regex 雙邊 enforce（前端 pattern + 即時提示 + API zod refine）
- API URL fallback：抽 `apps/web/src/lib/api-url.ts` 常數
- Tier discount 計算：spec R 的 preview endpoint 已 server side 算；payment/page.tsx 改成顯示 preview 值（不再自己算）

## Scope

### IN

| # | 修什麼 | 動作 |
|---|---|---|
| **R1** | 運費 + 免運門檻 → app_settings | 1 migration 加 5 key + admin/settings UI + `apps/api/src/lib/shipping.ts` helper + `apps/web/src/lib/shipping.ts` helper + orders.ts 兩處改、checkout/page.tsx + CartDrawer.tsx 改讀 |
| **R1.5** | 客服 email → app_settings | 確認 key 存在；contact.tsx / faq.tsx / terms.tsx 3 處改讀 server-side setting |
| **R2** | Order status labels 中央化 | 新 `apps/web/src/lib/order-status.ts`；4 處 import |
| **R3** | 統一編號驗證 | InvoiceSelector 加 `pattern="\\d{8}"` + 即時 inline error；API orders.ts invoice schema 加 `.refine(v => !v.taxId \|\| /^\\d{8}$/.test(v.taxId))` |
| **R4** | API URL fallback 常數化 | 新 `apps/web/src/lib/api-url.ts` + 至少 6 處改 import |
| **R4b** | tier discount 改用 preview | payment/page.tsx 移除本地 `memberDiscount * subtotal`；改顯示 preview.discounts 中 tier 相關 line |

### OUT
- Shipping carrier real-time fee API（黑貓宅配實價）— 未來
- I18n status labels（en/zh）— 未來
- Tax id 驗證寫到 amego.ts API call 前 sanity check — 已被 zod refine cover

## Design

### Section 1 — 運費 + 免運門檻進 app_settings (R1)

新 migration 0027：
```sql
INSERT INTO app_settings (key, value, description) VALUES
  ('shipping.fee_home_delivery', '100', '宅配運費 NT$'),
  ('shipping.fee_cvs', '60', '超商取貨運費 NT$'),
  ('shipping.free_threshold_home', '999', '宅配免運門檻 NT$ (0 = 永不免運)'),
  ('shipping.free_threshold_cvs', '499', '超商取貨免運門檻 NT$'),
  ('shipping.threshold_label', '滿 NT$ {{n}} 享免運', '免運提示模板')
ON CONFLICT (key) DO NOTHING;
```

API helper `apps/api/src/lib/shipping.ts`:
```ts
import { getSetting } from "./settings"
export async function computeShipping(method: "home_delivery"|"cvs_711"|"cvs_family", subtotal: number) {
  const isHome = method === "home_delivery"
  const fee = Number(await getSetting(isHome ? "shipping.fee_home_delivery" : "shipping.fee_cvs", "100"))
  const threshold = Number(await getSetting(isHome ? "shipping.free_threshold_home" : "shipping.free_threshold_cvs", "0"))
  if (threshold > 0 && subtotal >= threshold) return 0
  return fee
}
```

`orders.ts` 兩處（POST / 和 POST /preview）改用 `await computeShipping(method, subtotal)`，移除 hardcoded `{ home_delivery:100, ... }`。

前端 `apps/web/src/lib/shipping.ts` (同 source-of-truth)：把運費設定當作 server-side data 由 layout 預載：
- 在 layout.tsx 加 `getShippingConfig()` 一起 fetch (cache 300s)
- 透過 StorefrontShell prop 傳到 CartDrawer + checkout
- CartDrawer + checkout/page.tsx 移除 local hardcoded threshold

Admin UI 在 `/admin/settings` 加「運費」section：
- 宅配運費 / 超商運費 / 宅配免運門檻 / 超商免運門檻 4 個 input
- 改完 save → trigger refresh

### Section 2 — 客服 email 統一 (R1.5)

確認 `app_settings.contact.email` 已存在（grep `contact.email` in admin settings）。3 處改：
- `apps/web/src/app/contact/page.tsx` line 15：已 `info?.email ?? "love@realreal.cc"` — 確認 `info` 來源是 app_settings
- `apps/web/src/app/faq/page.tsx` line 98：硬寫 `love@realreal.cc` → 改成 server fetch
- `apps/web/src/app/terms/page.tsx` line 211：硬寫 `hello@realreal.cc` ⚠️ → 改成同 email source

簡化：頁面改 server component，fetch contact.email 一次 inject。

### Section 3 — Order status 中央化 (R2)

新 `apps/web/src/lib/order-status.ts`:
```ts
export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "待付款",
  processing: "處理中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失敗",
}
export const ORDER_STATUS_VARIANTS: Record<string, "default"|"outline"|"secondary"|"destructive"> = {
  pending: "outline", processing: "secondary", shipped: "default",
  completed: "default", cancelled: "destructive", failed: "destructive",
}
```

4 處改 `import { ORDER_STATUS_LABELS } from "@/lib/order-status"`：
- `my-account/_components/RecentOrdersSection.tsx`
- `my-account/orders/page.tsx`
- `my-account/orders/[id]/page.tsx`
- `admin/orders/[id]/_client.tsx`（同樣移除內嵌 `status === "pending"` 比較處）

### Section 4 — 統一編號驗證 (R3)

`apps/web/src/components/checkout/InvoiceSelector.tsx`：
```tsx
<Input
  pattern="\d{8}"
  inputMode="numeric"
  maxLength={8}
  value={value.taxId ?? ""}
  onChange={e => onChange({ ...value, taxId: e.target.value.replace(/\D/g, "").slice(0,8) })}
/>
{value.taxId && value.taxId.length !== 8 && (
  <p className="text-xs text-red-600">統一編號須為 8 位數字</p>
)}
```

API `apps/api/src/routes/orders.ts` 加：
```ts
const invoiceSchema = z.object({
  type: z.enum(["B2C_2","B2C_3","B2B"]),
  taxId: z.string().optional().refine(v => !v || /^\d{8}$/.test(v), "tax_id must be 8 digits"),
  // ... 其他 carrier 欄位
})
createOrderSchema = createOrderSchema.extend({ invoice: invoiceSchema.optional() })
```

### Section 5 — API URL 常數 (R4)

新 `apps/web/src/lib/api-url.ts`:
```ts
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
```

至少 6 處改 import：
- `app/admin/posts/categories/page.tsx`
- `app/admin/posts/categories/_client.tsx`
- `app/admin/kols/page.tsx`
- `app/checkout/page.tsx`
- `app/checkout/payment/page.tsx`
- `app/k/[slug]/_client.tsx`
- 等任何含 `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"` 的檔案

### Section 6 — Payment page 改用 preview (R4b)

`apps/web/src/app/checkout/payment/page.tsx`:
- 移除 `memberDiscount.discountRate` 本地計算 (line 191)
- 改用 preview endpoint：fetch /orders/preview 拿 server-side 結果
- 顯示 discounts[] 完整折抵清單（含 tier discount line）

## File summary

| 動作 | 路徑 | LOC |
|---|---|---|
| 新 | `packages/db/migrations/0027_shipping_settings.sql` | +25 |
| 新 | `apps/api/src/lib/shipping.ts` | +35 |
| 改 | `apps/api/src/routes/orders.ts` (2 處 hardcoded shipping + invoice schema refine) | +5 / -10 |
| 新 | `apps/web/src/lib/shipping.ts` | +30 |
| 新 | `apps/web/src/lib/order-status.ts` | +35 |
| 新 | `apps/web/src/lib/api-url.ts` | +5 |
| 改 | `apps/web/src/app/layout.tsx` (+shippingConfig fetch) | +5 |
| 改 | `apps/web/src/components/layout/StorefrontShell.tsx` (+prop forward) | +3 |
| 改 | `apps/web/src/components/cart/CartDrawer.tsx` (接 shippingConfig) | +5 / -5 |
| 改 | `apps/web/src/app/checkout/page.tsx` (接 shippingConfig + API_URL constant) | +5 / -10 |
| 改 | `apps/web/src/app/checkout/payment/page.tsx` (移 memberDiscount 本地計算 + preview integration) | +20 / -15 |
| 改 | `apps/web/src/components/checkout/InvoiceSelector.tsx` (taxId regex + inline error) | +10 |
| 改 | 3 個 my-account orders 頁 + 1 個 admin/orders detail (status labels import) | +4 / -40 |
| 改 | 3 處硬寫客服 email (contact/faq/terms) | +6 / -6 |
| 改 | 6+ API URL fallback import | +6 / -6 |
| 改 | `/admin/settings/page.tsx` 加運費 section | +25 |

預估 ~250 LOC code + ~50 LOC SQL/migration / 1 migration

## Validation

- ✅ tsc web + api 雙綠
- DB query: `SELECT key, value FROM app_settings WHERE key LIKE 'shipping.%'` 應有 4 row
- 改 admin 宅配運費 100→200 → checkout summary 立即顯示 NT$200
- 改宅配免運門檻 999→500 → 滿 NT$500 → 結帳顯示「免運」
- Checkout 輸入 taxId "ABC123" → 即時顯示「統一編號須為 8 位數字」+ submit 失敗
- 4 個 my-account orders 頁顯示同一份 STATUS_LABELS
- terms/page.tsx 客服 email 與 contact/faq 一致

## Risks

- **migration 套用前若已有 hardcoded 值在客戶 cart**：cart drawer 用舊 999 threshold 顯示「滿千免運」但結帳實際是新設定。一次性過渡，可接受
- **payment/page.tsx 整改用 preview**：若 preview API 失敗 frontend 顯示空。需 fallback display
- **Spec audit (workflow wae8b0u13) 可能再帶出新 issues**：若 P0 issue 出現，合進此 spec 一起 ship；若 P1 開新 spec T
