# Spec R — Checkout preview (展示活動折抵) + 已登入 prefill 收件資訊

**Date:** 2026-05-31
**Status:** Implemented
**Touches:** apps/api (1: orders.ts), apps/web (1: checkout/page.tsx), packages/db (0)
**Scope:** medium — ~200 LOC, 0 migration

## Why

兩個 checkout UX 問題：

### Issue #1 — 首購折扣不顯示
1. **DB 層**：user (gathertaiwan) 已有 1 筆 status=completed 訂單 → evaluator 判定不是首購 (正確)。
2. **UI 層**：🔥 checkout/page.tsx 從來沒呼叫 `evaluateAllCampaigns`。Evaluator 只在 POST /orders 跑 → 即使**真首購**，UI 也根本看不到 -NT$50 line。

### Issue #2 — 已登入仍需填姓名+手機
checkout 只 prefill email。`user_profiles` 已有 `display_name` / `phone` / `tax_id`，純粹沒寫 prefill code。

## Locked decisions
- **新 endpoint**：`POST /orders/preview` (optionalAuth, login + guest 都可用)
- **Display**：折抵 line 綠色，在商品小計與運費之間
- **Debounce 300ms**：cart 連續改動不爆 API
- **gathertaiwan 那筆 paid 訂單** 已 UPDATE status='cancelled' (RR1780081258657)
- **Prefill 統一編號**：若 user_profiles.tax_id 有值 → 預設 B2B 發票 (可改)
- **Prefill 都是 `if (!current) set`** — 不蓋掉使用者已輸入的值

## Design

### Section 1 — Backend `POST /orders/preview`

```ts
ordersRouter.post("/preview", optionalAuth, async (req, res) => {
  // parse items + shippingMethod
  // optional: fetch user_profile (tier_id, birthday, created_at) if userId
  // build cart items from variant lookup
  // build EvaluatorContext
  // call evaluateAllCampaigns
  // return { subtotal, shipping, discount_total, discounts:[], free_items, total }
})
```

### Section 2 — Frontend prefill (擴充既有 useEffect 2b)

```tsx
const { data: profile } = await supabase
  .from("user_profiles")
  .select("display_name, phone, tax_id")
  .eq("user_id", user.id).maybeSingle()
if (!name && profile.display_name) setName(profile.display_name)
if (!phone && profile.phone) setPhone(profile.phone)
if (profile.tax_id) setInvoice(prev => prev.type === "B2C_2" && !prev.taxId
  ? { ...prev, type: "B2B", taxId: profile.tax_id } : prev)
```

### Section 3 — Frontend preview fetch (useEffect 2c 新)

```tsx
useEffect(() => {
  const t = setTimeout(async () => {
    const res = await fetch(`${apiUrl}/orders/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ items, shippingMethod: apiMapped }),
    })
    if (res.ok) setPreview((await res.json()).data)
  }, 300)
  return () => clearTimeout(t)
}, [items, shippingMethod])
```

### Section 4 — Summary 渲染 (mobile + desktop 兩處同步改)

```tsx
const shippingFee = preview?.shipping ?? localShippingFee
const grandTotal = preview?.total ?? subtotal + localShippingFee
const discountLines = preview?.discounts ?? []

商品小計  NT$ X
{discountLines.map(d => <line className="text-emerald-700">{d.name} -NT$ {d.amount}</line>)}
運費      NT$ Y
合計      NT$ Z
```

## File summary

| 動作 | 路徑 | LOC |
|---|---|---|
| 改 | `apps/api/src/routes/orders.ts` (+POST /orders/preview) | +110 |
| 改 | `apps/web/src/app/checkout/page.tsx` (prefill + preview + summary x2) | +90 |
| DB 操作 | UPDATE orders SET status='cancelled' WHERE id=RR1780081258657 | 1 row |

## Validation
- ✅ tsc web + api 雙綠
- gathertaiwan 重新進 checkout → 應看到 -NT$50 line (因 paid 訂單已 cancelled)
- 改 shipping → 運費 + 折抵重算
- 新 email 註冊 → 立刻看到 -NT$50
- 已登入 → 姓名/手機/email/tax_id 自動填，可改

## Risks
- preview endpoint ~150ms; debounce 300ms 已 buffer
- shipping fee 客戶端 vs 服務端不一致 — 服務端覆寫，短期 OK；後續對齊
- preview 跟 order create 兩次跑 evaluator，間 race 罕見可接受
