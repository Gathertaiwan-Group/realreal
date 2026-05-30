# Spec F — 文章分類 admin CRUD + 文章 picker

**Date:** 2026-05-30
**Status:** Draft → pending user review (2 of 3 in E/F/G batch)
**Touches:** apps/web (1 new admin page + 1 patched posts editor + 1 sidebar nav), apps/api (1 route audit), packages/db (0 migrations)
**Scope:** small — ~300 LOC

## Why

`post_categories` 表 + `/api/post-categories.ts` CRUD endpoint **已存在** (見 grep `apps/api/src/routes/post-categories.ts`)，但**沒有 admin UI**。Admin 想分類文章只能登 SQL。

文章編輯器也沒「分類 dropdown」，現有貼文 category_id 應該都是 null。

## Locked decisions
- 跟 spec A (商品分類) 同模式，但是 post_categories
- 文章分類**單層**（不像商品分類有 parent/child），文章不需要二層歸類
- 嵌在「文章」項目下做 sub-nav (e.g., `/admin/posts/categories`) 而非全站獨立項目
- 文章列表頁加 filter chip 按分類過濾（small win）

## Scope

### IN
1. 新 `/admin/posts/categories/page.tsx` + `_client.tsx` — 平表 CRUD，inline edit
2. Audit `apps/api/src/routes/post-categories.ts` — 確認 GET admin list 帶 post_count；不足補
3. 文章編輯器 (`/admin/posts/[id]` 或 `/admin/posts/new`) 加分類 dropdown — 拉 GET /post-categories
4. 文章列表頁 (`/admin/posts/page.tsx`) 加分類 filter chip + 顯示分類欄
5. Sidebar 「文章」項目改成可展開的二級 nav（或直接加「文章分類」獨立項目，依現有 sidebar 設計決定）

### OUT
- 文章分類 hierarchy / parent (平表結構足夠)
- 多分類 (一篇文章只屬一個分類，跟既有 schema 一致)
- 分類 icon / 圖
- 分類 SEO meta

## Design

### Section 1 — Backend audit

`apps/api/src/routes/post-categories.ts` 既有（per earlier grep）：
- GET /post-categories — public
- POST /admin/post-categories — requireEditor
- PUT /admin/post-categories/:id — requireEditor
- DELETE /admin/post-categories/:id — requireAdmin

需確認 / 補充：
- GET /admin/post-categories 加 `post_count` (join COUNT)；若沒有 admin endpoint，改 public GET 加 admin auth
- DELETE 加保護：阻擋若有 post 引用 (`SELECT COUNT(*) FROM posts WHERE category_id = :id`)

### Section 2 — Admin UI

`apps/web/src/app/admin/posts/categories/page.tsx`：
- Server fetch via API
- Pass to `<PostCategoriesClient initialData={...} />`

`_client.tsx`：
- 平表（無 indent）：name (inline-edit) + slug (gray display) + post_count badge + [刪除] (disabled if count > 0)
- 上方「+ 新增分類」按鈕
- 不需 drag (文章分類無排序需求；按 created_at 顯示即可)

### Section 3 — Posts editor 加分類

`apps/web/src/app/admin/posts/[id]/page.tsx` (或 `_client.tsx`):
- useEffect fetch GET /post-categories on mount
- Form 加 `<select name="category_id">` with "— 未分類 —" option + 全 categories
- PUT payload 帶 category_id (uuid | null)

### Section 4 — Posts list 加 filter chip

`apps/web/src/app/admin/posts/page.tsx`：
- 上方加水平 chip bar: 「全部」+ 每個 category 一個 chip
- 點 chip → 過濾 list (client-side filter 或 URL query param `?category=slug`)

### Section 5 — Sidebar nav

`apps/web/src/app/admin/layout.tsx` 找「文章」NAV_ITEMS entry：
- 若 sidebar 支援 sub-menu，加 children: [{ href: "/admin/posts", label: "文章列表" }, { href: "/admin/posts/categories", label: "分類" }]
- 若不支援，加獨立 nav 項目「文章分類」緊接「文章」下方

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `apps/web/src/app/admin/posts/categories/page.tsx` |
| 新 | `apps/web/src/app/admin/posts/categories/_client.tsx` |
| 改 | `apps/api/src/routes/post-categories.ts` (加 post_count + DELETE 保護) |
| 改 | `apps/web/src/app/admin/posts/[id]/page.tsx` (or _client.tsx) — 加 category dropdown |
| 改 | `apps/web/src/app/admin/posts/page.tsx` (加 filter chips + 分類欄) |
| 改 | `apps/web/src/app/admin/layout.tsx` (sidebar nav) |

預估 ~250 LOC 新增 / ~80 LOC 修改 / 0 migration

## Validation

1. `tsc` / `next build` 雙綠
2. /admin/posts/categories 進去能建分類 + 改名 + 刪 (空 / 非空)
3. /admin/posts 編輯任一文章 → 選分類 → 存後刷新顯示已分類
4. /admin/posts 列表 chip 過濾顯示對應文章

## Known caveats

- 平表設計：若日後業務需巢狀（例如「健康知識」下分「營養」「運動」），需另案改 schema 加 parent_id（post_categories 目前可能沒此 column —— 若有就 ignore）。
- 刪保護用 SQL count，若有 race condition (delete + 新貼文同時) 可接受；admin 工作量低。
- 文章列表 chip 數量多時須考慮捲動或下拉，但分類數 < 10 時無問題。
