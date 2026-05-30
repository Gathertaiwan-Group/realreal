# Spec A — Categories admin CRUD + campaign linkage

**Date:** 2026-05-30
**Status:** Draft → pending user review (1 of 4 in marketing/tier overhaul batch)
**Touches:** apps/api (verify existing routes), apps/web (1 new admin page, 1 small admin/campaigns patch, 1 sidebar nav add), packages/db (0 migrations)
**Scope:** small — ~400 LOC

## Why

`apps/web/src/app/admin/categories/` 完全不存在。Categories 表 (`packages/db/migrations/0001_initial.sql` line 24-30) 早就有 (id / name / slug / parent_id / sort_order)，public `GET /categories` 也有 (`apps/api/src/routes/categories.ts:29`)，但**沒有 admin UI** — admin 想新增 / 改名 / 改 slug / 換 parent 都得直接登 SQL。

連帶造成：
- 行銷活動的 `category_slug` 是文字輸入框（admin 得記住分類 slug）
- 商品編輯器的「商品分類 dropdown」雖然存在 (spec 2026-05-30-product-editor-cleanup)，但無法新增新分類

## Locked decisions
- 分類最多 2 層（parent + children），不做樹狀無限巢狀
- slug 從 name 自動產生（漢字 → pinyin 或 fallback uuid prefix）
- 刪除受保護：若有商品 / 活動指向該分類 → 阻擋並顯示 count

## Scope

### IN
1. `/admin/categories/page.tsx` + `_client.tsx` — 樹狀列表 + 新增 / 編輯 / 刪除 / 拖曳排序
2. Admin API endpoints (確認既有 / 補齊): `POST /admin/categories`, `PUT /admin/categories/:id`, `DELETE /admin/categories/:id`
3. 列表頁 GET 加 `product_count` join (`COUNT(products)`) + `campaign_count` (`COUNT(campaigns) WHERE config->>'category_slug' = slug`)
4. Admin sidebar nav 加「分類」連結
5. 行銷活動 config form 內 `category_slug` 從 `<input>` 改 `<select>` — 從 GET /categories 拉

### OUT
- 分類圖示 / 圖片
- SEO meta 標題、描述、og:image per category
- 多語系
- 第 3+ 層巢狀（業務上不會用到）

## Design

### Section 1 — Backend API audit

`apps/api/src/routes/categories.ts` 現況：
```
GET  /categories   — public (line 29)
```

需要新增 (確認後缺哪補哪 by grep):
```
GET    /admin/categories      — list + product_count + campaign_count, requireEditor
POST   /admin/categories      — create { name, slug?, parent_id?, sort_order? }, requireAdmin
PUT    /admin/categories/:id  — update partial, requireAdmin
DELETE /admin/categories/:id  — delete, requireAdmin; 阻擋若有 children OR products OR campaigns

zod schema：
- name: string min 1 max 100
- slug: string regex /^[a-z0-9-]+$/ (auto-gen 若空)
- parent_id: uuid nullable (不可循環，不可選自己)
- sort_order: int >= 0
```

Slug 自動產生：用簡化規則 — `name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "")`，若結果為空 (純漢字)，fallback `cat-${randomUUID().slice(0,8)}`。

### Section 2 — Admin UI (`apps/web/src/app/admin/categories/`)

`page.tsx` (server)：
```ts
import { createClient } from "@/lib/supabase/server"
export default async function Page() {
  const supabase = await createClient()
  // Fetch via API instead of direct DB (so product_count is included)
  return <CategoriesClient initialData={...} />
}
```

`_client.tsx`：
- 樹狀渲染：第一層 = `parent_id IS NULL`，第二層 = 該 row 的 children，indent 1 level
- 每 row：
  - drag handle (≡ icon) 改 sort_order
  - name (inline-edit, blur → PATCH)
  - slug (灰字，顯示而已；改名後 admin 手動點「重生」icon 才會更新 slug — 避免不小心改 slug 造成既有外連結 404)
  - product_count + campaign_count badge (小數字)
  - [+ 子分類] (僅第一層顯示) / [刪除] (灰色若 count > 0)
- 上方「+ 新增頂層分類」按鈕

複用既有 `AdminTabs` 圖案？不複用 — 這頁獨立一個項目，不屬於行銷或商品 tab 集合。Sidebar 「商品」下方加新項目「分類」。

### Section 3 — Sidebar nav

`apps/web/src/app/admin/layout.tsx` 找到 `NAV_ITEMS` array (per recent spec admin C-strategy)。在「商品」項目下方加：
```ts
{ href: "/admin/categories", label: "分類", icon: Folders, roles: ["admin", "editor"] }
```
或 nest 在 「商品」 sub-menu（依現有 sidebar 結構決定，實作時 grep 確認）。

### Section 4 — 行銷活動 category_slug dropdown

`apps/web/src/app/admin/campaigns/page.tsx` 的 `ConfigFields` 函式找到 `category_slug` 那行 input。改成：
```tsx
const [categories, setCategories] = useState<{ slug: string; name: string }[]>([])
useEffect(() => { fetch(`${API_URL}/categories`).then(r => r.json()).then(j => setCategories(j.data ?? [])) }, [])
...
<select name={`${prefix}_category_slug`} ...>
  <option value="">— 選擇分類 —</option>
  {categories.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
</select>
```

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `apps/web/src/app/admin/categories/page.tsx` |
| 新 | `apps/web/src/app/admin/categories/_client.tsx` |
| 新 | `apps/web/src/app/admin/categories/actions.ts` (server actions, optional) |
| 改/驗 | `apps/api/src/routes/categories.ts` — 加 admin CRUD endpoints (audit 是否已存在) |
| 改 | `apps/web/src/app/admin/layout.tsx` — sidebar nav 加 「分類」 |
| 改 | `apps/web/src/app/admin/campaigns/page.tsx` — `category_slug` input → dropdown |

預估 ~400 LOC 新增 / ~50 LOC 修改 / 0 migration

## Validation

1. `npm run build` apps/api / `next build` apps/web 雙綠
2. `npm test` apps/api 不退步（仍 33+6 evaluator/customer tests + 18 pre-existing failures）
3. 建立、改名、改 parent、刪除分類（有 product 應擋）每樣手測一次
4. 商品編輯器選分類存得進去
5. 行銷活動 config 改完 category_slug 後存得進去

## Known caveats

- Slug auto-gen 對純漢字 fallback 到 `cat-<uuid前 8 碼>`，admin 想要好讀的 slug 須手動改。
- 刪除阻擋 product / campaign 雙重檢查，但 campaign 檢查是字串 JSON 比對 (`config->>'category_slug' = slug`)，若有 typo / 拼錯就漏抓；可接受 (admin 自己改錯 slug 不在 spec 防護範圍)。
- 第二層分類不可再加第三層 — UI 上「+ 子分類」按鈕只在第一層 row 顯示。
