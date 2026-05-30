# Spec E — 行銷活動 config 改用搜尋型 picker

**Date:** 2026-05-30
**Status:** Draft → pending user review (1 of 3 in E/F/G batch)
**Touches:** apps/web (3 new components + 1 admin page patch), apps/api (verify GET endpoints), packages/db (0 migrations)
**Scope:** small — ~250 LOC

## Why

User feedback (截圖：「贈品 SKU = RR-FD-SAMPLE 太難記」)：

行銷活動 config 目前用文字輸入接幾個關鍵 ID/slug 欄位 — admin 得用腦記。
- `category_slug` (5 type 用到) — 雖然 Spec A 已 半路 改成 dropdown，但邏輯散在 `ConfigFields`，本案統整成共用 `CategoryPicker`
- `gift_sku` (freebie type) — 仍是 raw text；admin 得查資料庫
- `tier_slug` (tier_upgrade_bonus type) — 仍是 raw text

業務影響：每設一個 campaign 就要查表，慢且容易打錯。

## Locked decisions
- 3 個 picker component：CategoryPicker (dropdown) / ProductPicker (搜尋自動完成) / TierPicker (dropdown)
- 全部放 `apps/web/src/app/admin/campaigns/_pickers/`，僅本頁使用，不放共用 components
- ProductPicker debounce 300ms；最多顯示 10 個結果
- 選擇後 form 仍記錄 slug / sku / tier_id 等 ID 值（資料庫 schema 不動）

## Scope

### IN
1. `CategoryPicker.tsx` — dropdown 拉 GET /categories，options 顯示中文 name；emit slug
2. `ProductPicker.tsx` — type-ahead input 搜 GET /products?search=...&limit=10；顯示「商品名 (SKU)」；emit { sku, name } 兩個 field（觸發 onChange 同步更新 form 兩個 input）
3. `TierPicker.tsx` — dropdown 拉 GET /membership-tiers；options 顯示中文 name；emit tier_id (或 slug，依現有 config 鍵)
4. `apps/web/src/app/admin/campaigns/page.tsx` ConfigFields 整合 3 個 picker：
   - 所有用 `category_slug` 的 type 改用 CategoryPicker
   - `freebie` type 的 `gift_sku` + `gift_name` 改用 ProductPicker (一個 picker 同時填兩個 hidden input)
   - `tier_upgrade_bonus` type 的 `tier_slug` 改用 TierPicker
5. 確認 backend GET /products 有 `?search=name` filter；若無補上 (`.ilike("name", "%"+search+"%")`)

### OUT
- 變體 (variant) 搜尋（gift_sku 目前以 product SKU 為單位，不細到 variant）
- 多選 picker（每個 picker 一次只選一個）
- Picker keyboard 鍵盤導航（v1 滑鼠操作即可）
- 圖示 thumbnail 顯示（純文字 list）

## Design

### Section 1 — `apps/web/src/app/admin/campaigns/_pickers/CategoryPicker.tsx`

```tsx
"use client"
import { useState, useEffect } from "react"

interface Props {
  name: string         // hidden input name (form field key)
  defaultValue?: string
}

export function CategoryPicker({ name, defaultValue = "" }: Props) {
  const [categories, setCategories] = useState<{ slug: string; name: string }[]>([])
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    fetch(`${API_URL}/categories`).then(r => r.json())
      .then(j => setCategories(j.data ?? []))
  }, [])

  return (
    <select name={name} value={value} onChange={(e) => setValue(e.target.value)} className={selectClass}>
      <option value="">— 選擇分類 —</option>
      {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
    </select>
  )
}
```

### Section 2 — `apps/web/src/app/admin/campaigns/_pickers/ProductPicker.tsx`

```tsx
"use client"
interface Props {
  skuName: string       // form field for SKU
  nameFieldName: string // form field for product name
  defaultSku?: string
  defaultName?: string
}

export function ProductPicker({ skuName, nameFieldName, defaultSku, defaultName }: Props) {
  const [query, setQuery] = useState(defaultName ?? "")
  const [selected, setSelected] = useState<{ sku: string; name: string } | null>(
    defaultSku ? { sku: defaultSku, name: defaultName ?? "" } : null
  )
  const [results, setResults] = useState<{ sku: string; name: string }[]>([])
  const [open, setOpen] = useState(false)

  // Debounced search
  useEffect(() => {
    if (!query || (selected && selected.name === query)) return
    const handle = setTimeout(async () => {
      const res = await fetch(`${API_URL}/products?search=${encodeURIComponent(query)}&limit=10`)
      const json = await res.json()
      // products may have multiple variants; flatten to first variant's SKU per product
      const items = (json.data ?? []).flatMap((p: any) =>
        (p.variants ?? [{ sku: p.sku }]).map((v: any) => ({ sku: v.sku ?? p.sku, name: p.name }))
      ).filter((x: any) => x.sku)
      setResults(items)
      setOpen(true)
    }, 300)
    return () => clearTimeout(handle)
  }, [query])

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(null) }}
        placeholder="搜尋商品名稱..."
        className={inputClass}
        autoComplete="off"
      />
      {/* hidden form fields actually submitted */}
      <input type="hidden" name={skuName} value={selected?.sku ?? ""} />
      <input type="hidden" name={nameFieldName} value={selected?.name ?? ""} />
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-60 overflow-auto">
          {results.map(r => (
            <li key={r.sku}>
              <button
                type="button"
                onClick={() => { setSelected(r); setQuery(r.name); setOpen(false) }}
                className="w-full px-3 py-2 text-left hover:bg-zinc-50"
              >
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-zinc-500 font-mono">{r.sku}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="mt-1 text-xs text-zinc-500">已選：{selected.name} <span className="font-mono">({selected.sku})</span></div>
      )}
    </div>
  )
}
```

### Section 3 — `apps/web/src/app/admin/campaigns/_pickers/TierPicker.tsx`

Identical structure to CategoryPicker but fetches `GET /membership-tiers` and emits `tier_id` (uuid). For `tier_upgrade_bonus`'s `tier_slug` we may need server-side mapping; the existing config seems to use either `tier_slug` or `tier_id` — verify in implementation. If tier_slug used, store the tier's slug; else id.

### Section 4 — Patch ConfigFields in admin/campaigns/page.tsx

Find the existing `ConfigFields` function. For each type:

- **discount, points_multiplier, second_half_price, combo_discount, buy_x_get_y**: replace `category_slug` text input with `<CategoryPicker name="{prefix}_category_slug" defaultValue={...} />`
- **freebie**: replace `gift_sku` + `gift_name` two text inputs with single `<ProductPicker skuName="{prefix}_gift_sku" nameFieldName="{prefix}_gift_name" defaultSku={...} defaultName={...} />`
- **tier_upgrade_bonus**: replace `tier_slug` text input with `<TierPicker name="{prefix}_tier_slug" defaultValue={...} />`

Existing form submission (`extractConfig`) reads field values; no change needed since pickers still submit via the same hidden field names.

### Section 5 — Backend audit (`apps/api/src/routes/products.ts`)

Check GET /products handles `?search=`. If not:
```ts
let query = supabase.from("products").select(...)
if (req.query.search) {
  const s = String(req.query.search).trim()
  if (s) query = query.ilike("name", `%${s}%`)
}
```

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `apps/web/src/app/admin/campaigns/_pickers/CategoryPicker.tsx` |
| 新 | `apps/web/src/app/admin/campaigns/_pickers/ProductPicker.tsx` |
| 新 | `apps/web/src/app/admin/campaigns/_pickers/TierPicker.tsx` |
| 改 | `apps/web/src/app/admin/campaigns/page.tsx` (ConfigFields 整合 3 picker) |
| 改/驗 | `apps/api/src/routes/products.ts` (確認 ?search 支援) |

預估 ~250 LOC 新增 / ~80 LOC 修改 / 0 migration

## Validation

1. `tsc` / `next build` 雙綠
2. 編輯 freebie campaign：型態選「滿額贈品」→ ProductPicker 出現；搜「凍乾」→ 看到「凍乾水果試吃包 (RR-FD-SAMPLE)」可選；存得進去
3. 編輯 discount campaign + 指定分類：CategoryPicker dropdown 顯示中文分類；存得進去
4. 編輯 tier_upgrade_bonus：TierPicker dropdown 顯示「金卡會員」等；存得進去

## Known caveats

- ProductPicker 一次只能選一個 SKU；若顧客需要送多個贈品要建多個 freebie campaign。
- 搜尋只比對 name (ilike `%name%`)，不搜 SKU。Admin 不確定品名要先去商品頁查。
- Picker 不支援鍵盤上下選 — v1 滑鼠操作。
- 既有 campaigns 的 raw text 內容仍可正常 read & save（picker default 值能載入）；只在 admin UI 上改成 picker。
