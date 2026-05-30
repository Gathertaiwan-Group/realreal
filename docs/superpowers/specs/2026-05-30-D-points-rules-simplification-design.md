# Spec D — 點數規則簡化（7 鍵砍到 2 鍵）

**Date:** 2026-05-30
**Status:** Draft → pending user review (4 of 4 in marketing/tier overhaul batch)
**Touches:** apps/api (1 lib modified, 1 settings file modified), apps/web (1 admin page modified), packages/db (0 migrations)
**Scope:** small — ~200 LOC

## Why

`/admin/marketing/points` 目前長一張 form 7 個欄位：
1. ratio (1 點 = NT$ ?)
2. min_redeem
3. max_redeem_pct
4. allow_coupon_stack
5. apply_to_shipping
6. apply_to_sale
7. expire_days

User 抱怨「太複雜」，要：
- 保留：**ratio**（換算）+ **expire_days**（過期，這屬 ledger 層而非結帳層，沒法塞 campaign）
- 砍：其他 5 個（min / max_pct / coupon_stack / shipping / sale）
- 砍掉的規則：用合理 hardcoded 預設 (min=0, max=100%, stack=yes, shipping=no, sale=yes)；之後若特定行銷期需要不同行為，建一個 campaign override（spec OUT，留下擴充 hook）

業務影響：admin 設一次點數規則一輩子用，預設行為對 99% 業務情境合理。複雜需求 (e.g., 雙11 例外) 走 campaign 不再走全域 setting。

## Locked decisions
- 全域點數 setting 從 7 鍵砍到 2 鍵：`ratio` + `expire_days`
- 5 個被砍的 setting 改 hardcoded defaults in `lib/points.ts`：
  - `min_redeem = 0`
  - `max_redeem_pct = 100`
  - `allow_coupon_stack = true`
  - `apply_to_shipping = false`
  - `apply_to_sale = true`
- `app_settings` 表內的 `points.min_redeem` / `max_redeem_pct` / `allow_coupon_stack` / `apply_to_shipping` / `apply_to_sale` 鍵不主動 DELETE（避免破壞 audit），只從 ALLOWED_KEYS 拿掉 → admin UI 看不到、未來寫入會被 reject、`getSettingOrEnv` 取到也忽略
- 「需特殊規則」走 campaign — 標 OUT 為「未來 spec：新 campaign type `points_rule_override`」的 hook

## Scope

### IN
1. `/admin/marketing/points/page.tsx` form 砍到 2 個 input
2. `apps/api/src/lib/points.ts` `calcPointsDiscount` 內 hardcode 5 個 default，不再讀 settings (除 ratio + expire_days)
3. `apps/api/src/lib/settings.ts` `ALLOWED_KEYS` 把 `points.min_redeem|max_redeem_pct|allow_coupon_stack|apply_to_shipping|apply_to_sale` 5 個移除
4. UI 上方加說明文字：「若需特定活動有不同折抵規則，請至『行銷活動』建立 campaign 客製化（未來功能）」

### OUT
- 新增 `points_rule_override` campaign type — 未來 spec
- 已寫入 app_settings 的 5 個鍵的清理 — 用不到自動忽略，不刪
- ledger source `manual_adjust` 或 `promo` 仍正常運作

## Design

### Section 1 — admin UI 砍欄位

`apps/web/src/app/admin/marketing/points/page.tsx` 修改：

**現況**：8+ 欄位（含 stats card），form 一張長表
**改後**：2 個 input + 統計 card 保留 + 一段 hint 文字

```tsx
<form onSubmit={handleSave} className="space-y-4 max-w-md">
  <div>
    <Label>換算 — 1 點折抵金額（新台幣）</Label>
    <div className="flex items-center gap-2 mt-1">
      <span>1 點 = NT$</span>
      <Input type="number" min="0" step="0.01" value={ratio} onChange={...} />
    </div>
  </div>
  <div>
    <Label>過期 — 點數自獲得日起算的有效天數</Label>
    <div className="flex items-center gap-2 mt-1">
      <Input type="number" min="0" value={expireDays} onChange={...} className="w-24" />
      <span>天（0 = 永不過期）</span>
    </div>
  </div>
  <Button type="submit">儲存</Button>
</form>

<Card className="mt-6 bg-amber-50/40 border-amber-200/60 p-4 text-sm text-[#687279]">
  <p className="font-medium text-[#10305a]">折抵預設行為（hardcode）</p>
  <ul className="mt-2 ml-4 list-disc space-y-0.5">
    <li>最少折抵：0 點起（不限）</li>
    <li>單筆上限：訂單金額 100%（可全額折抵）</li>
    <li>可與優惠券疊加：是</li>
    <li>可折抵運費：否</li>
    <li>可折抵特價商品：是</li>
  </ul>
  <p className="mt-2 text-xs">若特定活動需不同規則，至「行銷活動」tab 設定 campaign 內的覆蓋規則（功能尚未開放）。</p>
</Card>
```

### Section 2 — lib/points.ts 改 calcPointsDiscount

```ts
export async function calcPointsDiscount(cart, requestedPoints): Promise<{ allowed: boolean; discount: number; reason?: string }> {
  const ratio = Number(await getSettingOrEnv("points.ratio", "POINTS_RATIO", "1")) || 1
  
  // Hardcoded defaults (was: read from settings 5 keys)
  const MIN_REDEEM = 0
  const MAX_REDEEM_PCT = 100
  const APPLY_TO_SHIPPING = false
  const APPLY_TO_SALE = true
  // (allow_coupon_stack 是 checkout-level rule — orders.ts 內不需查；coupon + points 永遠允許同套)
  
  if (requestedPoints <= 0) return { allowed: false, discount: 0, reason: "請輸入要折抵的點數" }
  if (requestedPoints < MIN_REDEEM) return { allowed: false, discount: 0, reason: `最少 ${MIN_REDEEM} 點` }
  
  const eligible = (APPLY_TO_SHIPPING ? cart.total : cart.subtotal)
                 - (APPLY_TO_SALE ? 0 : cart.sale_item_total)
  const cap = Math.floor(eligible * MAX_REDEEM_PCT / 100)
  const maxPoints = Math.floor(cap / ratio)
  
  if (requestedPoints > maxPoints) return { allowed: false, discount: 0, reason: `最多 ${maxPoints} 點` }
  
  return { allowed: true, discount: requestedPoints * ratio }
}
```

注意：`expire_days` 仍由 grantPoints 在 ledger 寫入 expires_at 時使用，保留設定。

### Section 3 — settings.ts 鎖 KEY

`apps/api/src/lib/settings.ts` 內 `ALLOWED_KEYS` 找到 `points` section 把 5 個 key 移除：

**現況**（推測，需 grep verify）：
```ts
"points.ratio", "points.min_redeem", "points.max_redeem_pct",
"points.allow_coupon_stack", "points.apply_to_shipping",
"points.apply_to_sale", "points.expire_days"
```

**改後**：
```ts
"points.ratio", "points.expire_days"
```

PUT /admin/settings 收到被砍的 key → reject 400 with 「該 key 已停用，請改用 campaign 設定」。

`SECTIONS.points.keys` 同步只列剩 2 個（如 spec 2026-05-30-points 用 SECTIONS map 區分 admin UI grouping）。

## File summary

| 動作 | 路徑 |
|---|---|
| 改 | `apps/web/src/app/admin/marketing/points/page.tsx` (砍 5 欄、加 hint card) |
| 改 | `apps/api/src/lib/points.ts` (calcPointsDiscount hardcode 5 defaults) |
| 改 | `apps/api/src/lib/settings.ts` (ALLOWED_KEYS 砍 5 key) |
| 改 (optional) | `apps/api/test/points.test.ts` — 移除測試 5 setting 互動的 case（仍可保留 ratio + expire test）|

預估 ~80 LOC 修改 / ~120 LOC 新增（UI 重排）/ 0 migration

## Validation

1. `npm run build` / `tsc` 雙綠
2. 既有 `points.test.ts` 全綠（除可能要更新 5 個 setting mock）
3. /admin/marketing/points 進去看到 2 個 input + hint card
4. PUT /admin/settings { "points.min_redeem": 100 } 應回 400 reject
5. 結帳行為不變：使用點數仍可折抵、有 max 100% cap、可疊 coupon、不可折運費、可折特價

## Known caveats

- 既有 app_settings 表內可能殘留 `points.min_redeem` 等已寫入紀錄 — 不刪，純 ignored；audit 可保留歷史。
- 5 個 hardcoded 預設未來若大規模改動需求出現，需新 spec（per-campaign override）— 已標明 OUT。
- 「allow_coupon_stack=true」全域硬寫 = 任何顧客付款都可同時用 coupon + points。若日後想關掉，需新 setting 或 campaign rule。
