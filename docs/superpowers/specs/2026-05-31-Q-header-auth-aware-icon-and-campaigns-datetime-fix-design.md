# Spec Q — Header auth-aware icon + Admin campaigns datetime save bug fix

**Date:** 2026-05-31
**Status:** Implemented
**Touches:** apps/web (3 files), apps/api (1 file), packages/db (0)
**Scope:** small — ~80 LOC, 0 migration

## Why

兩個獨立但同 session 出現的問題，一起 ship：

### Part 1: Header icon 分不出已/未登入
User 截圖右上角 User icon 無論登入狀態長一樣 → 使用者不知道自己是不是登入中 → 點下去才知道。

業界標準：已登入秀 avatar / 首字母圓圈、未登入秀普通 user icon。

### Part 2: Admin 行銷活動「更新失敗」
User 編輯滿額贈品活動 → 儲存 → toast「更新失敗」。

根因：`<input type="datetime-local">` 回傳 `"2026-05-31T11:28"`（無時區），但 API zod schema `z.string().datetime()` 要求 ISO 8601 含時區 → 400 → 前端顯示通用 fallback 訊息「更新失敗」。

bonus: `campaignCreateSchema.type` 的 z.enum 沒包 `first_purchase`（spec O 加的新 type），admin UI 試圖編輯首購活動會同樣壞。

## Locked decisions
- Auth detection: **server-side** in `layout.tsx`（既有 supabase server client + 我們已 async）
- Avatar 形式: **藍色圓圈 + 首字母**（user choice，IG/Threads 同 pattern）
- 首字母來源優先級: `display_name` → `email` → 略過（不顯示）
- 未登入點擊: `/auth/login?redirect=/my-account`
- 已登入點擊: `/my-account`（總覽含訂單）
- Bug fix: 前端 `new Date(localStr).toISOString()` 轉一下；API schema 同時把 `first_purchase` 補進 enum

## Scope

### IN
1. `apps/web/src/app/layout.tsx` — 加 `supabase.auth.getUser()` + `user_profiles.display_name` query
2. `apps/web/src/components/layout/StorefrontShell.tsx` — `headerUser` prop forward 給 Header
3. `apps/web/src/components/layout/Header.tsx` — Conditional render avatar vs User icon
4. `apps/web/src/app/admin/campaigns/page.tsx` — `handleCreate` + `handleUpdate` 兩處改 ISO conversion
5. `apps/api/src/routes/campaigns.ts` — `campaignCreateSchema.type` enum 加 `first_purchase`

### OUT
- 下拉式 user menu (logout / settings 等) — 點擊直接進 /my-account 就好，my-account layout 已含 logout
- Server action revalidate（fetch user 每次 navigation 都 fresh，因為 layout 是動態）
- Email-based fallback when both display_name + email 都空（理論不會發生，因為 Supabase Auth 必 email）

## Design

### Part 1 — Auth-aware Header

**`apps/web/src/app/layout.tsx`** (server component, already async):
```tsx
const supabase = await createClient()
const [categories, { data: { user } }] = await Promise.all([
  getCategories(),
  supabase.auth.getUser(),
])

let headerUser: { initial: string } | null = null
if (user) {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .single()
  const seed = (profile?.display_name?.trim() || user.email || "").trim()
  if (seed) headerUser = { initial: seed.charAt(0).toUpperCase() }
}
```

每次 SSR fetch 一次 — getCategories 已 cache 300s，auth.getUser 走 cookie，profile query 是單筆 PK lookup，整體 < 50ms。

**`StorefrontShell`** 加 `headerUser` prop forward。

**`Header.tsx`** 右上角 conditional:
```tsx
{headerUser ? (
  <Link href="/my-account" aria-label={`我的帳戶（${headerUser.initial}）`}>
    <span className="h-8 w-8 rounded-full bg-[#10305a] text-white flex items-center justify-center font-semibold">
      {headerUser.initial}
    </span>
  </Link>
) : (
  <Link href="/auth/login?redirect=/my-account" aria-label="登入">
    <User className="h-5 w-5" style={{ color: "#10305a" }} />
  </Link>
)}
```

### Part 2 — Campaigns datetime bug

**前端** `apps/web/src/app/admin/campaigns/page.tsx`:
```diff
- starts_at: fd.get("starts_at"),
- ends_at: (fd.get("ends_at") as string) || null,
+ const startsAtRaw = (fd.get("starts_at") as string) || ""
+ const endsAtRaw = (fd.get("ends_at") as string) || ""
+ ...
+ starts_at: startsAtRaw ? new Date(startsAtRaw).toISOString() : new Date().toISOString(),
+ ends_at: endsAtRaw ? new Date(endsAtRaw).toISOString() : null,
```
共 2 處 (handleCreate + handleUpdate)。

**API** `apps/api/src/routes/campaigns.ts`:
```diff
- type: z.enum([..., "birthday_bonus"]),
+ type: z.enum([..., "birthday_bonus", "first_purchase"]),
```

## File summary

| 動作 | 檔案 | LOC |
|---|---|---|
| 改 | `apps/web/src/app/layout.tsx` | +18 |
| 改 | `apps/web/src/components/layout/StorefrontShell.tsx` | +5 |
| 改 | `apps/web/src/components/layout/Header.tsx` | +18 / -5 |
| 改 | `apps/web/src/app/admin/campaigns/page.tsx` | +8 / -2 |
| 改 | `apps/api/src/routes/campaigns.ts` | ±1 |

預估 ~50 LOC / 0 migration

## Validation

- ✅ `tsc` web + api 雙綠
- 訪問 `/` 未登入 → 右上角線條 User icon
- 訪問 `/` 已登入 (你 armand7951@gmail.com) → 右上角藍色圓圈「A」(email 首字母)
- 點圓圈 → 進 `/my-account`
- 點線條 icon → 進 `/auth/login?redirect=/my-account`
- `/admin/campaigns` 編輯任何活動 → 儲存 → toast「活動已更新」(不是「更新失敗」)
- `/admin/campaigns` 編輯「首購折 NT$50」→ 儲存 → 不再 enum 拒絕

## Risks

- **`auth.getUser()` 失敗**：fallback 給空，整站沒登入感 — 但網站 work
- **`display_name` 是中文**：`charAt(0)` 在 surrogate-pair emoji 字會壞，但中文/英文都 safe
- **每次 navigation re-fetch profile**：profile select 是 1 row by indexed user_id，<10ms — 可接受
- **datetime ISO conversion 時區**：`new Date("2026-05-31T11:28")` 用 user 瀏覽器時區轉 UTC ISO — 行為符合 user 預期（user 輸入是當地時間）
