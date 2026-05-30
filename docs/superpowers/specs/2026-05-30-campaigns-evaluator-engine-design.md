# Campaigns Evaluator Engine — 把整套行銷活動接上線

**Date:** 2026-05-30
**Status:** Draft → pending user review
**Touches:** apps/api (1 new lib, 1 new route, 3 modified libs, 1 modified route), apps/web (1 modified admin page, 1 new preview UI), packages/db (1 migration), tests (~22 evaluator + 4 integration)
**Scope:** large — ~1500 LOC new + 400 LOC modified

## Why

`campaigns` table + admin UI + 11 templates exist since migration 0006/0011, but **the checkout flow in `apps/api/src/routes/orders.ts` never reads the table**. Grep `campaigns\b` in `orders.ts / lib/ / workers/` returns 0 matches. The visible 7 "進行中" campaigns are decorative:

- 5 tier-discount campaigns (初心/知心/同心常態95/95/9折) — duplicate of `membership_tiers.discount_rate`; tier discount system delivers the % regardless
- 2 birthday campaigns (生日當月 9 折 + 2x rebate) — completely non-functional; no code reads `config.promo_type=birthday`
- 2 disabled bundle/freebie campaigns — non-functional even if activated
- 11 templates importable from admin → all create more dead records

Business impact: marketing flexibility is *theoretical*; admin can configure any campaign but only tier % + coupons actually fire.

User chose Option C — implement evaluators for all 10 existing types + add 1 new (`birthday_bonus`) to retire the dead birthday campaigns.

## Locked decisions (with user 2026-05-30)

1. **Precedence**: subtotal → tier discount → **campaigns** → coupon → points
2. **Stacking**: A — same `type` picks best one (highest discount); different types stack
3. **Scope**: single `category_slug` per campaign; multi-category via multiple campaigns
4. **Cleanup**: hard-delete 3 redundant tier campaigns (初心/知心/同心 常態 N 折); convert 2 birthday campaigns to new `birthday_bonus` type

## Scope

### IN

1. New `apps/api/src/lib/campaigns-evaluator.ts` — 11 evaluators + helpers + `evaluateAllCampaigns` orchestrator
2. New `birthday_bonus` type added to CHECK constraint + zod enum
3. `apps/api/src/routes/orders.ts` checkout — invoke `evaluateAllCampaigns`, accumulate discounts, persist to new `orders` columns
4. `apps/api/src/lib/points.ts` — `grantPoints` reads active `points_multiplier` + `birthday_bonus` campaigns and multiplies rebate
5. `apps/api/src/lib/tier.ts` — `upgradeTierIfNeeded` triggers `tier_upgrade_bonus` campaigns via `adjustPoints(source=promo)`
6. New endpoint `POST /admin/campaigns/preview` — runs evaluator against mock cart, returns `EvaluatorResult`
7. Migration 0019 — DELETE 3 redundant rows, UPDATE 2 birthday rows, alter CHECK constraint, ALTER orders ADD 3 columns
8. Admin UI fixes (apps/web/src/app/admin/campaigns/page.tsx):
   - Render 限定等級 column from already-fetched `membership_tiers(name)` (today's bug: shows 全部等級 always)
   - 11 templates remain hardcoded; group by category (折扣/贈品/運費/點數/組合/生日/升等)
   - Type icons + complete 中文 labels for all 11
   - Per-type zod-driven config form (no free-form JSON)
   - "📊 預覽折抵" button — POST preview endpoint, render result inline
9. Tests — 22 evaluator unit tests (positive + negative per type), 4 integration tests (stacking, precedence, scope, birthday window)

### OUT
- Campaign analytics dashboard (which campaign saved how much $) — future
- Customer-facing "已套用優惠 X" detail on /shop/cart — checkout payment page already shows discount lines; campaigns roll into a single "活動折抵" line for v1
- Cross-tier promotions (e.g., "金卡專屬週末免運") — already supported via existing `tier_id` column, no extra UI for "weekday filter" etc. Out of scope.
- Coupon vs campaign exclusion rules — coupon stacking with campaigns just follows precedence (campaigns first, then coupon). No "可疊/不可疊" toggle per campaign.
- `bundle` type's `free_item_rule: same_item` (only `lowest_price`/`highest_price` supported initially)

## Design

### Section 1 — Migration 0019

`packages/db/migrations/0019_campaigns_evaluator_engine.sql`:

```sql
-- 1. New type 'birthday_bonus'
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_type_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_type_check CHECK (
  type IN (
    'discount','freebie','points_multiplier','free_shipping',
    'bundle','buy_x_get_y','second_half_price','spend_threshold',
    'tier_upgrade_bonus','combo_discount','birthday_bonus'
  )
);

-- 2. Convert birthday campaigns to new type
UPDATE campaigns
SET type = 'birthday_bonus',
    config = config - 'promo_type' || '{"birthday_window_days": 31}'::jsonb
WHERE config->>'promo_type' = 'birthday';

-- 3. Delete redundant tier-discount campaigns (tier discount system delivers)
DELETE FROM campaigns
WHERE name IN (
  '初心之友常態95折',
  '知心之友常態95折',
  '同心之友常態9折'
);

-- 4. orders new columns for evaluator output
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS campaign_discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_campaign_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS free_items JSONB NOT NULL DEFAULT '[]'::jsonb;
```

### Section 2 — Evaluator engine

`apps/api/src/lib/campaigns-evaluator.ts` (new, ~600 LOC):

#### Core types
```ts
export type CartItem = {
  product_id: string
  variant_id: string
  category_id: string | null
  sku: string | null
  name: string
  unit_price: number       // dollar (not cents) for evaluator math; orders.ts converts
  qty: number
}

export type EvaluatorContext = {
  user: { id: string; tier_id: string | null; birthday: string | null }
  cart: {
    items: CartItem[]
    subtotal: number          // sum(unit_price × qty)
    shipping_fee: number
  }
}

export type EvaluatorResult = {
  campaign_id: string
  campaign_name: string
  type: string
  applied: boolean
  reason?: string                           // when !applied: why
  discount_amount?: number                  // dollars off subtotal
  free_items?: Array<{ sku?: string; product_id?: string; qty: number; name?: string }>
  rebate_multiplier?: number                // for points_multiplier / birthday_bonus
  zero_shipping?: boolean                   // for free_shipping
}
```

#### 11 evaluators

```ts
// 1. discount — folder/scope %/fixed
function evalDiscount(c, ctx): EvaluatorResult {
  const cfg = c.config as { discount_method; discount_value; scope; category_slug? }
  const items = resolveScopeItems(cfg.scope, cfg.category_slug, ctx.cart.items)
  if (items.length === 0) return notApplied(c, "scope 內無商品")
  const sub = sumItems(items)
  const discount = cfg.discount_method === "percent"
    ? Math.round(sub * Number(cfg.discount_value) / 100)
    : Math.min(Number(cfg.discount_value), sub)
  return { ...applied(c), discount_amount: discount }
}

// 2. freebie — 滿額贈品
function evalFreebie(c, ctx): EvaluatorResult {
  const cfg = c.config as { min_order_amount; gift_sku; gift_qty; gift_name }
  if (ctx.cart.subtotal < cfg.min_order_amount) return notApplied(c, "subtotal 未達門檻")
  return { ...applied(c), free_items: [{ sku: cfg.gift_sku, qty: cfg.gift_qty, name: cfg.gift_name }] }
}

// 3. points_multiplier — 公益點數加倍 (不影響 checkout 金額，影響 grantPoints)
function evalPointsMultiplier(c, ctx): EvaluatorResult {
  const cfg = c.config as { multiplier; scope; category_slug? }
  const items = resolveScopeItems(cfg.scope, cfg.category_slug, ctx.cart.items)
  if (items.length === 0) return notApplied(c, "scope 內無商品")
  return { ...applied(c), rebate_multiplier: Number(cfg.multiplier) }
}

// 4. free_shipping — 滿額免運
function evalFreeShipping(c, ctx): EvaluatorResult {
  const cfg = c.config as { min_order_amount }
  if (ctx.cart.subtotal < cfg.min_order_amount) return notApplied(c, "subtotal 未達門檻")
  return { ...applied(c), zero_shipping: true }
}

// 5. bundle — 全場 cart total qty 買 N 送 M (any items)
function evalBundle(c, ctx): EvaluatorResult {
  const cfg = c.config as { buy_quantity; free_quantity; free_item_rule }
  const totalQty = ctx.cart.items.reduce((s, i) => s + i.qty, 0)
  if (totalQty < cfg.buy_quantity) return notApplied(c, `總件數 ${totalQty} < ${cfg.buy_quantity}`)
  // Explode items into per-unit list, sort by price, pick N lowest/highest
  const units = explodeUnits(ctx.cart.items)
  const sorted = cfg.free_item_rule === "highest_price"
    ? units.sort((a, b) => b.unit_price - a.unit_price)
    : units.sort((a, b) => a.unit_price - b.unit_price)
  const freed = sorted.slice(0, cfg.free_quantity)
  const discount = freed.reduce((s, u) => s + u.unit_price, 0)
  return { ...applied(c), discount_amount: discount }
}

// 6. buy_x_get_y — scope 內 買 X 送 Y (可指定同品項 or 跨品項)
function evalBuyXGetY(c, ctx): EvaluatorResult {
  const cfg = c.config as { buy_quantity; get_quantity; scope; category_slug?; same_item_only; free_item_rule; max_uses_per_order }
  const items = resolveScopeItems(cfg.scope, cfg.category_slug, ctx.cart.items)
  const scopeQty = items.reduce((s, i) => s + i.qty, 0)
  const possibleUses = Math.floor(scopeQty / (cfg.buy_quantity + cfg.get_quantity))
  const uses = Math.min(possibleUses, cfg.max_uses_per_order ?? 999)
  if (uses === 0) return notApplied(c, `scope 件數 ${scopeQty} 不足 1 組`)
  const totalFreeUnits = uses * cfg.get_quantity
  // Pick freed units per free_item_rule
  const units = explodeUnits(items)
  const sorted = cfg.free_item_rule === "highest_price"
    ? units.sort((a, b) => b.unit_price - a.unit_price)
    : units.sort((a, b) => a.unit_price - b.unit_price)
  const freed = sorted.slice(0, totalFreeUnits)
  const discount = freed.reduce((s, u) => s + u.unit_price, 0)
  return { ...applied(c), discount_amount: discount }
}

// 7. second_half_price — scope 內 第二件 X 折
function evalSecondHalfPrice(c, ctx): EvaluatorResult {
  const cfg = c.config as { discount_percent; scope; category_slug?; max_pairs }
  const items = resolveScopeItems(cfg.scope, cfg.category_slug, ctx.cart.items)
  const units = explodeUnits(items).sort((a, b) => a.unit_price - b.unit_price)
  const possiblePairs = Math.floor(units.length / 2)
  const pairs = Math.min(possiblePairs, cfg.max_pairs ?? 999)
  if (pairs === 0) return notApplied(c, `scope 件數 ${units.length} 不足 1 對`)
  // Each pair: discount on the cheaper unit
  const discount = units.slice(0, pairs).reduce((s, u) => s + u.unit_price * cfg.discount_percent / 100, 0)
  return { ...applied(c), discount_amount: Math.round(discount) }
}

// 8. spend_threshold — 滿額折抵
function evalSpendThreshold(c, ctx): EvaluatorResult {
  const cfg = c.config as { min_amount; discount_amount }
  if (ctx.cart.subtotal < cfg.min_amount) return notApplied(c, "subtotal 未達門檻")
  const discount = Math.min(cfg.discount_amount, ctx.cart.subtotal)
  return { ...applied(c), discount_amount: discount }
}

// 9. tier_upgrade_bonus — 升等獎勵 (不在 checkout，hook in upgradeTierIfNeeded)
//    在 evaluator 中始終 notApplied (它由 tier.ts 直接呼叫，不走 cart)
function evalTierUpgradeBonus(c, ctx): EvaluatorResult {
  return notApplied(c, "tier_upgrade_bonus 由 upgradeTierIfNeeded 觸發，不在 checkout")
}

// 10. combo_discount — 任選 N 件 M 折
function evalComboDiscount(c, ctx): EvaluatorResult {
  const cfg = c.config as { min_items; discount_percent; scope; category_slug? }
  const items = resolveScopeItems(cfg.scope, cfg.category_slug, ctx.cart.items)
  const scopeQty = items.reduce((s, i) => s + i.qty, 0)
  if (scopeQty < cfg.min_items) return notApplied(c, `scope 件數 ${scopeQty} < ${cfg.min_items}`)
  const sub = sumItems(items)
  const discount = Math.round(sub * cfg.discount_percent / 100)
  return { ...applied(c), discount_amount: discount }
}

// 11. birthday_bonus ★新 — 生日當月 X 折 + Y 倍 rebate
function evalBirthdayBonus(c, ctx): EvaluatorResult {
  const cfg = c.config as { discount_method; discount_value; rebate_multiplier?; birthday_window_days }
  if (!ctx.user.birthday) return notApplied(c, "顧客無生日資料")
  if (!isInBirthdayWindow(ctx.user.birthday, cfg.birthday_window_days)) {
    return notApplied(c, "不在生日當月 window 內")
  }
  const discount = cfg.discount_method === "percent"
    ? Math.round(ctx.cart.subtotal * Number(cfg.discount_value) / 100)
    : Math.min(Number(cfg.discount_value), ctx.cart.subtotal)
  return { ...applied(c), discount_amount: discount, rebate_multiplier: cfg.rebate_multiplier }
}
```

#### Orchestrator + helpers

```ts
export async function evaluateAllCampaigns(ctx: EvaluatorContext): Promise<EvaluatorResult[]> {
  const active = await fetchActiveCampaignsForUser(ctx.user.id, ctx.user.tier_id)
  const results = await Promise.all(active.map(c => evaluateCampaign(c, ctx)))
  return pickBestPerType(results.filter(r => r.applied))
}

async function fetchActiveCampaignsForUser(userId, tierId) {
  const now = new Date().toISOString()
  const { data } = await supabase.from("campaigns")
    .select("*").eq("is_active", true).lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .or(`tier_id.is.null,tier_id.eq.${tierId ?? "00000000-0000-0000-0000-000000000000"}`)
  return data ?? []
}

function pickBestPerType(results: EvaluatorResult[]): EvaluatorResult[] {
  const byType = new Map<string, EvaluatorResult>()
  for (const r of results) {
    const existing = byType.get(r.type)
    if (!existing || (r.discount_amount ?? 0) > (existing.discount_amount ?? 0)) {
      byType.set(r.type, r)
    }
  }
  return Array.from(byType.values())
}

// Per-process in-memory cache; slug → id. Populated on first miss via DB lookup.
const categorySlugCache = new Map<string, string>()

async function getCategoryIdBySlug(slug: string): Promise<string | undefined> {
  if (categorySlugCache.has(slug)) return categorySlugCache.get(slug)
  const { data } = await supabase.from("categories").select("id").eq("slug", slug).maybeSingle()
  if (data?.id) { categorySlugCache.set(slug, data.id); return data.id }
  return undefined
}

async function resolveScopeItems(scope: string, slug: string | undefined, items: CartItem[]): Promise<CartItem[]> {
  if (scope === "all") return items
  if (!slug) return []
  const catId = await getCategoryIdBySlug(slug)
  if (!catId) return []
  return items.filter(i => i.category_id === catId)
}
// NOTE: resolveScopeItems is now async — all evaluators that call it (1,3,6,7,10) must `await`.

function explodeUnits(items: CartItem[]): CartItem[] {
  return items.flatMap(i => Array.from({ length: i.qty }, () => ({ ...i, qty: 1 })))
}

function sumItems(items: CartItem[]): number {
  return items.reduce((s, i) => s + i.unit_price * i.qty, 0)
}

function isInBirthdayWindow(birthday: string, windowDays: number): boolean {
  const bd = new Date(birthday)
  const now = new Date()
  // simplify: in birthday month within window
  const bdThisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate())
  const diffDays = (now.getTime() - bdThisYear.getTime()) / 86400000
  return diffDays >= -1 && diffDays <= windowDays
}

function notApplied(c, reason): EvaluatorResult {
  return { campaign_id: c.id, campaign_name: c.name, type: c.type, applied: false, reason }
}

function applied(c): Pick<EvaluatorResult, "campaign_id" | "campaign_name" | "type" | "applied"> {
  return { campaign_id: c.id, campaign_name: c.name, type: c.type, applied: true }
}
```

### Section 3 — Integration in 3 paths

#### Path 1: checkout (apps/api/src/routes/orders.ts)

After tier discount calculation, before coupon:

```ts
// Build EvaluatorContext from cart
const ctx: EvaluatorContext = {
  user: { id: userId, tier_id: profile.membership_tier_id, birthday: profile.birthday },
  cart: { items: cartItems, subtotal: subtotalCents / 100, shipping_fee: shippingFeeCents / 100 }
}
const campaignResults = await evaluateAllCampaigns(ctx)

// Aggregate
let campaignDiscountCents = 0
const freeItems: any[] = []
for (const r of campaignResults) {
  if (r.discount_amount) campaignDiscountCents += Math.round(r.discount_amount * 100)
  if (r.free_items) freeItems.push(...r.free_items)
  if (r.zero_shipping) shippingFeeCents = 0
}
const appliedCampaignIds = campaignResults.map(r => r.campaign_id)

// Subtract from running total BEFORE coupon
const baseAfterCampaigns = Math.max(0, subtotalCents - memberDiscountCents - campaignDiscountCents)

// Existing coupon logic uses baseAfterCampaigns instead of baseAfterMember
// ...

// Insert into orders
await supabase.from("orders").insert({
  ...,
  campaign_discount: campaignDiscountCents / 100,
  applied_campaign_ids: appliedCampaignIds,
  free_items: freeItems,
})
```

#### Path 2: grantPoints (apps/api/src/lib/points.ts)

```ts
export async function grantPoints(orderId, userId, orderAmount, tierId) {
  // ... existing code to compute earned based on rebate_rate
  
  // NEW: check active points_multiplier + birthday_bonus campaigns for this user
  const ctx = await buildContextForUser(userId)
  const results = await evaluateAllCampaigns(ctx)
  const multipliers = results
    .filter(r => r.rebate_multiplier && r.rebate_multiplier > 1)
    .map(r => r.rebate_multiplier!)
  // Stacking: best-of-type already applied; multiply all surviving multipliers
  const effectiveMultiplier = multipliers.reduce((m, x) => m * x, 1)
  earned = Math.round(earned * effectiveMultiplier)
  
  // ... insert ledger row, note: "× <multiplier> from campaigns [<ids>]"
}
```

#### Path 3: tier upgrade (apps/api/src/lib/tier.ts)

```ts
export async function upgradeTierIfNeeded(userId, newTotalSpend) {
  // ... existing tier-finding logic
  if (newTier && newTier.id !== currentTierId) {
    // Apply upgrade
    await supabase.from("user_profiles").update(...)
    
    // NEW: trigger tier_upgrade_bonus campaigns matching the new tier
    const now = new Date().toISOString()
    const { data: bonusCampaigns } = await supabase.from("campaigns")
      .select("*").eq("type", "tier_upgrade_bonus").eq("is_active", true)
      .lte("starts_at", now).or(`ends_at.is.null,ends_at.gt.${now}`)
    
    for (const c of bonusCampaigns ?? []) {
      if (c.config?.tier_id === newTier.id) {
        const bonusPoints = Number(c.config?.bonus_points ?? 0)
        if (bonusPoints > 0) {
          await adjustPoints(userId, bonusPoints, `升等獎勵：${c.name}`, null, "promo", c.id)
        }
      }
    }
  }
}
```

### Section 4 — Admin UI (`apps/web/src/app/admin/campaigns/page.tsx`)

#### Fix existing bugs
1. **限定等級 column**: data already includes `membership_tiers(name)` via select join (campaigns.ts:35). Render: `c.membership_tiers?.name ?? "全部等級"` (column today always shows literal "全部等級" string).
2. **type 文案**: TYPE_LABEL only covers 9; add `birthday_bonus: "生日當月優惠"` + complete missing labels.

#### New: type icons + grouping for templates
Reorganize PRESET_TEMPLATES rendering into groups:
```
[折扣] 全館 95 折 / 任選 3 件 88 折 / 任選 5 件 8 折 / 第二件半價 / 第二件 6 折
[贈品] 滿額贈品凍乾試吃包
[運費] 滿 800 免運
[組合] 買一送一蛋白粉 / 買三送二凍乾水果
[滿額] 滿千折百 / 滿 2000 折 300
[點數] 公益存款雙倍
[生日] (templates 加 2 個：生日當月 9 折 + 雙倍 / 生日當月 95 折)
[升等] (template 加 1 個：升金卡贈 500 點 / 升鑽石贈 1000 點)
```

#### Per-type config form (zod-driven)
Today the form has hardcoded fields per type but no validation. Add client-side zod schemas matching server-side; show inline errors on submit.

#### Preview button
New "📊 預覽折抵" button in edit modal. POSTs `/admin/campaigns/preview`:
```json
{ "type": "discount", "config": {...}, "mock_cart": { "subtotal": 2000, "items": [...] } }
```
Returns `EvaluatorResult`; render inline:
- ✅ applied: "折抵 NT$ X"
- ❌ not applied: red text with reason

Mock cart default: NT$ 2000 subtotal, 2 蛋白粉 + 1 凍乾水果 (sample real categories).

### Section 5 — `POST /admin/campaigns/preview` endpoint

`apps/api/src/routes/campaigns.ts`:
```ts
campaignsRouter.post("/admin/campaigns/preview", requireAuth, requireEditor, async (req, res) => {
  const { type, config, mock_cart, mock_user } = req.body
  const fakeCampaign = { id: "preview", name: "Preview", type, config }
  const ctx: EvaluatorContext = {
    user: mock_user ?? { id: "preview", tier_id: null, birthday: null },
    cart: mock_cart ?? defaultMockCart,
  }
  const result = evaluateCampaign(fakeCampaign as any, ctx)
  res.json({ result })
})
```

### Section 6 — Testing

`apps/api/test/campaigns-evaluator.test.ts` (~500 LOC):

- 11 types × 2 cases (positive + negative) = 22 unit tests
- `pickBestPerType`: 2 same-type campaigns → only the higher-discount survives
- `resolveScopeItems`: scope=all returns all; scope=specific_categories filters correctly
- `isInBirthdayWindow`: today=birthday, +1 day, +30 days (in), +32 days (out), no birthday
- Integration: full `evaluateAllCampaigns` with 3 types — confirms stacking

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0019_campaigns_evaluator_engine.sql` |
| 新 | `apps/api/src/lib/campaigns-evaluator.ts` |
| 改 | `apps/api/src/routes/orders.ts` (precedence integration ~50 LOC insert) |
| 改 | `apps/api/src/lib/points.ts` (multiplier in grantPoints ~30 LOC) |
| 改 | `apps/api/src/lib/tier.ts` (tier_upgrade_bonus in upgradeTierIfNeeded ~30 LOC) |
| 改 | `apps/api/src/routes/campaigns.ts` (zod enum + preview endpoint ~150 LOC) |
| 改 | `apps/web/src/app/admin/campaigns/page.tsx` (filter render + grouping + preview ~200 LOC) |
| 新 | `apps/api/test/campaigns-evaluator.test.ts` (~500 LOC) |
| 改 | `apps/api/test/admin-orders.cancel.test.ts` (確認 cancel orchestrator 不影響新欄) |

## Validation

1. `npm run build` apps/api / `next build` apps/web 雙綠
2. `npm test` apps/api 新增 ~26 個 test、全綠；既有 18 個 pre-existing failures 不變
3. Migration 0019 透過 Supabase Management API 套用 (一次貼)
4. Railway api/worker / Vercel web push 觸發 auto deploy
5. Smoke：
   - admin 進 /admin/campaigns 看到「限定等級」欄真的顯示 tier name
   - 點任一 campaign 開編輯 → 按「預覽折抵」→ 看到 evaluator 真的算出折抵金額
   - 模擬一筆 NT$2000 訂單付款 → 確認 orders.campaign_discount 寫進 DB、ledger note 含「× X from campaigns」
   - 改某 tier 升等門檻 + tier_upgrade_bonus campaign 啟用 → 模擬升等 → 確認 +bonus_points 進 ledger

## Known caveats

- `tier_upgrade_bonus` 不在 cart-time 評估 (evaluator returns notApplied)；只由 `upgradeTierIfNeeded` 直接呼叫。Admin UI 上要標明「此類型由升等事件觸發，與訂單無關」。
- `evaluateAllCampaigns` 每筆訂單呼叫一次，cache 為 in-memory categoryCache。如 categories 改動，須重啟 API 或加 TTL。本案不做 cache invalidation。
- `bundle` evaluator 的 `free_item_rule: same_item` 暫不支援；UI 上隱藏該選項。
- 顧客結帳頁面（apps/web/src/app/checkout/payment/page.tsx）目前不顯示 campaign 細節，只 server-side 結算。前台「已套用 X 個優惠」UX 為另案。
- `points_multiplier` 在 grantPoints 內部評估，跟 checkout-time 的 evaluator 結果是「同一筆 evaluateAllCampaigns」的兩個 caller。預期語意一致，但兩處呼叫實際抓 active campaigns 兩次（DB hit ×2）。性能可接受，後續可優化共用 result。
- `birthday_bonus` 用顧客 birthday `MM-DD`，跨年情況（12/30 生日，2/1 結帳）會 `isInBirthdayWindow=false`。可接受預設，必要時可加 `birthday_wrap_year: true` 配置。

## Cleanup checklist (post-deploy)

- [ ] 刪除 3 個重複 tier campaigns (migration 已含)
- [ ] 確認 2 個 birthday campaigns 已轉成 `birthday_bonus` type (migration 已含)
- [ ] Admin 後台 verify「限定等級」column render 正確
- [ ] 至少 1 個生日 campaign 測通：找一個生日當月顧客做測試
- [ ] tier_upgrade_bonus 至少建 1 個 demo campaign (升金卡贈 500 點)
