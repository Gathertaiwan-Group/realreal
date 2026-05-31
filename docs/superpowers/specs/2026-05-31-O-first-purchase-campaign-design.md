# Spec O — 首購活動 (first_purchase campaign type)

**Date:** 2026-05-31
**Status:** Draft (user approved defaults)
**Touches:** apps/api (1 evaluator function + 1 helper), apps/web (1 template entry + 1 config panel), packages/db (0)
**Scope:** small — ~150 LOC, 0 migration

## Why

- 提升新客 conversion rate — 首購折扣是 e-commerce funnel 的第一道吸引力
- 既有 11 個 campaign type 沒涵蓋 first-time buyer
- 模板要對應加 `首購折 NT$50`（user 截圖中模板區「折扣」分類）

## Locked decisions (user approved)
- **折抵類型**：固定 NT$50（admin 可改）
- **首購定義**：user 沒有任何 `processing` / `shipped` / `completed` 訂單（已付款＝entered post-checkout pipeline）
- **時間窗口**：無（admin 可加 days_since_signup）
- **最低訂單金額**：無（admin 可加 min_order_amount）
- **Guest checkout**：不享受（沒 user_id 無法判斷首購）
- **疊加**：跟其他 type 自動疊加（既有 `pickBestPerType` 邏輯）；同 first_purchase type 同 cart 只取最優一個

## Scope

### IN
1. Evaluator: `evalFirstPurchase()` in `apps/api/src/lib/campaigns-evaluator.ts`
2. Helper: `isFirstPurchase(userId)` SQL query
3. Wire into `evaluateCampaign()` switch
4. Template registry: 「首購折 NT$50」under 折扣 category in admin campaigns templates modal
5. Admin config UI: panel for `first_purchase` type fields (3 inputs)
6. Checkout 顯示：折抵明細 line 標 `首購折抵 NT$50`

### OUT
- DB migration (type 是 text，不需 enum 改動)
- Email/LINE 通知（未來補；可走既有 enqueue-post-payment hook）
- Repeat first-purchase 防呆（order count = 0 自然 enforce，不需額外 dedup）
- Multi-discount stacking 規則改動（既有 `pickBestPerType` 自動處理）
- Guest checkout 首購支援（v2 再說，需 email-based dedup table）

## Design

### Section 1 — Evaluator + Helper

`apps/api/src/lib/campaigns-evaluator.ts` 新增：

```ts
async function isFirstPurchase(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false  // guest 不算首購
  const supabase = getServiceClient()
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['processing', 'shipped', 'completed'])
  if (error) {
    console.warn('[first-purchase] check failed:', error.message)
    return false  // fail closed
  }
  return (count ?? 0) === 0
}

export async function evalFirstPurchase(
  c: CampaignRow,
  ctx: EvaluatorContext,
): Promise<EvaluatorResult> {
  const cfg = getConfig(c)
  const discountAmount = asNumber(cfg.discount_amount) ?? 50
  const minOrderAmount = asNumber(cfg.min_order_amount) ?? 0
  const daysSinceSignup = asNumber(cfg.days_since_signup)  // optional

  // 1) Subtotal threshold
  const subtotal = sumItems(ctx.items)
  if (subtotal < minOrderAmount) {
    return notApplied(c, `未達最低訂單金額 NT$${minOrderAmount}`)
  }

  // 2) First-purchase check (DB)
  const isFirst = await isFirstPurchase(ctx.userId)
  if (!isFirst) return notApplied(c, '不是首購')

  // 3) Optional signup-window check
  if (daysSinceSignup && ctx.userCreatedAt) {
    const daysAgo = (Date.now() - new Date(ctx.userCreatedAt).getTime()) / 86400000
    if (daysAgo > daysSinceSignup) {
      return notApplied(c, `超過註冊後 ${daysSinceSignup} 天`)
    }
  }

  return applied(c, discountAmount, `首購折抵 NT$${discountAmount}`)
}
```

Wire into `evaluateCampaign()` switch (around line 507-540):
```ts
case 'first_purchase':
  return evalFirstPurchase(c, ctx)
```

If `EvaluatorContext` 不含 `userCreatedAt`，加上：
```ts
export type EvaluatorContext = {
  userId?: string | null
  userCreatedAt?: string | null  // ISO string, for optional signup-window
  // ... existing fields
}
```
Caller (orders.ts / checkout flow) 填 `ctx.userCreatedAt = user.created_at`。

### Section 2 — Template registry

`apps/web/src/app/admin/campaigns/page.tsx`，append to "discount" category templates (line ~110-115):

```ts
{
  name: "首購折 NT$50",
  description: "新客首次下單折抵 50 元",
  type: "first_purchase",
  config: {
    discount_amount: 50,
    min_order_amount: 0,
  },
},
```

按「全部匯入」按鈕後，admin 立刻多一筆 active campaign。

### Section 3 — Admin config UI

在 campaign edit form 的 type-switch 加 `first_purchase` 分支（同樣位置目前有 spend_threshold、free_shipping 等各 type 的 config panel）：

```tsx
{type === 'first_purchase' && (
  <div className="space-y-3">
    <div>
      <Label>折抵金額 (NT$)</Label>
      <Input
        type="number"
        value={config.discount_amount ?? 50}
        onChange={e => setConfig({ ...config, discount_amount: Number(e.target.value) })}
      />
    </div>
    <div>
      <Label>最低訂單金額 (NT$)</Label>
      <Input
        type="number"
        value={config.min_order_amount ?? 0}
        onChange={e => setConfig({ ...config, min_order_amount: Number(e.target.value) })}
        placeholder="0 = 無門檻"
      />
    </div>
    <div>
      <Label>註冊後 N 天內 (留空 = 永遠首購)</Label>
      <Input
        type="number"
        value={config.days_since_signup ?? ''}
        onChange={e => setConfig({ ...config, days_since_signup: e.target.value ? Number(e.target.value) : undefined })}
        placeholder="例如 30"
      />
    </div>
  </div>
)}
```

### Section 4 — Checkout 顯示

既有 `evaluateAllCampaigns()` 已會把 applied results 加進 cart breakdown。`first_purchase` 用同樣 path → 結帳頁自動顯示 `首購折抵 NT$50` line。無需額外 frontend 改動。

驗證 method：到 checkout summary component (`apps/web/src/app/checkout/` 下) 確認既有 render loop 不依賴 hardcoded type list — 預期 OK，因為 `EvaluatorResult` 是 generic shape。

### Section 5 — Validation

| Test | Expected |
|---|---|
| `tsc` 雙綠 | ✅ |
| Admin campaigns templates modal | 折扣 category 顯示 6 個（原 5 個 + 首購折 NT$50） |
| 「全部匯入」按鈕 | 多 1 筆 active campaign type=first_purchase |
| 新 user 註冊（orders=0）→ 加商品 → checkout | 折抵明細顯示 `首購折抵 NT$50` |
| 你（armand7951@gmail.com，有舊 order）→ checkout | 折抵明細**不**顯示 first_purchase |
| Guest → checkout | 折抵明細**不**顯示 first_purchase |
| Admin config 改 discount_amount=100 | checkout 顯示 `首購折抵 NT$100` |

## File summary

| 動作 | 路徑 | LOC |
|---|---|---|
| 改 | `apps/api/src/lib/campaigns-evaluator.ts` (evalFirstPurchase + isFirstPurchase + switch) | +60 |
| 改 | `apps/api/src/lib/campaigns-evaluator.ts` (EvaluatorContext type, if missing userCreatedAt) | +3 |
| 改 | caller 加 `userCreatedAt` (apps/api/src/routes/orders.ts 或 checkout 路徑) | +5 |
| 改 | `apps/web/src/app/admin/campaigns/page.tsx` (template entry + config panel) | +60 |

預估 ~130 LOC / 0 migration

## Risks
- **`orders.status` 已 verify**：production DISTINCT = `cancelled` / `completed` / `failed` / `pending` / `processing` / `shipped`。沒 `paid`，已將 'paid' 改為 'processing'（已付款進入處理階段）。
- **`pickBestPerType` 不需改** — 自動按 type 字串 group，新 type 自動納入。
- **多次 admin 改 active=true 同時間**：order processing 仍能正確 evaluate，因為每次 cart 重算。
- **重複下單**：order paid 之後 user 再加商品 → isFirstPurchase 立刻回 false → 不會再給。
- **EvaluatorContext.userCreatedAt 改動**：caller 要補；若 caller 忘記填，daysSinceSignup check 會 skip（fail open，會多給折扣不會少給）— acceptable v1。
