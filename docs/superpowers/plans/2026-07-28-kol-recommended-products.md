# KOL 專屬推薦商品 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓每個 KOL 的推薦商品頁面（`/k/[slug]`）顯示該 KOL 專屬勾選的商品，取代目前寫死抓全站 `is_featured` 商品、上限 8 筆的邏輯。

**Architecture:** 在 `kols` 表加一個 `recommended_product_ids uuid[]` 欄位（陣列順序即顯示順序）。後台新增一個多選＋可排序的商品勾選元件，寫入時 API 端過濾掉不存在/已下架的商品 ID。公開的 KOL landing page API 依陣列順序回傳商品資料；前端拿掉舊的 `getFeaturedProducts()`，改吃這份資料；若陣列為空，「推薦商品」整個區塊不顯示。

**Tech Stack:** Express + Zod + Supabase (apps/api)、Next.js App Router + React（apps/web）、Vitest + Supertest（apps/api 既有測試慣例）。

---

## 背景 / 前置依賴

規格文件：[docs/superpowers/specs/2026-07-28-kol-recommended-products-design.md](../specs/2026-07-28-kol-recommended-products-design.md)

**重要限制：執行計畫的人（或 agent）沒有直接對正式 Supabase 資料庫執行 SQL DDL 的能力**（只有 PostgREST REST API 存取權限，沒有 `DATABASE_URL` / `psql` / 已連結的 Supabase CLI）。Task 1 寫完 migration 檔案後，**必須請使用者自行到 Supabase Dashboard 的 SQL Editor 手動執行**，才能繼續 Task 2 之後的驗證步驟（因為 Task 2/3 的 curl 手動驗證都需要這個欄位真的存在於正式資料庫）。這不是選項，是往下走的硬性阻塞點。

---

### Task 1: 資料庫 migration — 新增 `kols.recommended_product_ids`

**Files:**
- Create: `packages/db/migrations/0048_kol_recommended_products.sql`

- [ ] **Step 1: 寫 migration 檔案**

```sql
-- 0048: Add kols.recommended_product_ids for per-KOL recommended products.
--
-- Background: /k/[slug] 的「推薦商品」區塊原本抓全站 is_featured=true 商品
-- （寫死 limit=8），不管哪個 KOL 頁面看到的都是同一份清單。這個欄位讓每個
-- KOL 可以有自己專屬、可排序的推薦商品清單。
--
-- 陣列順序 = 顯示順序，不另外開 sort_order 欄位。不加 FK constraint
-- （Postgres 陣列型別不支援），改由 API 寫入前驗證每個 ID 都存在且未下架。
--
-- Spec: docs/superpowers/specs/2026-07-28-kol-recommended-products-design.md

ALTER TABLE kols
  ADD COLUMN IF NOT EXISTS recommended_product_ids UUID[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN kols.recommended_product_ids IS
  '此 KOL 專屬推薦商品的 product id 陣列，陣列順序即前台顯示順序。由 apps/api/src/routes/admin-kols.ts 寫入前過濾成只保留存在且 is_active=true 的商品。';
```

- [ ] **Step 2: 請使用者手動執行 migration（阻塞點）**

停下來，用這段訊息請使用者執行：

> 我沒有直接寫入正式資料庫 schema 的權限，麻煩你到 Supabase Dashboard → SQL Editor，貼上並執行 `packages/db/migrations/0048_kol_recommended_products.sql` 的內容。執行完跟我說一聲，我再繼續下一步。

**等使用者確認執行完成後才能進行 Task 2 的手動驗證步驟。** Task 2/3 的程式碼修改可以先寫，但實際跑 curl 驗證要等這步完成。

- [ ] **Step 3: 驗證欄位已存在（使用者確認執行完後）**

```bash
curl -s "https://ozwftlkgqmewtadypsfi.supabase.co/rest/v1/kols?select=id,slug,recommended_product_ids&limit=1" \
  -H "apikey: <service role key，從 apps/api/.env 的 SUPABASE_SERVICE_ROLE_KEY 複製>" \
  -H "Authorization: Bearer <同上>"
```
Expected: 回傳的物件裡有 `"recommended_product_ids":[]`（不是 404 / column not found 錯誤）。**不要把真實的 service role key 貼進這份計畫文件本身**——這份檔案會被 commit 進 git，貼固定金鑰進去會外洩憑證；執行時再從 `apps/api/.env`（未進版控）現查現用。

- [ ] **Step 4: Commit**

```bash
git add packages/db/migrations/0048_kol_recommended_products.sql
git commit -m "feat(db): add kols.recommended_product_ids for per-KOL products"
```

---

### Task 2: `admin-kols.ts` — 接受並驗證 `recommended_product_ids`

**Files:**
- Modify: `apps/api/src/routes/admin-kols.ts:38-53` (schema), `:96-100` (GET list select), `:146-150` (GET detail select), `:222-226` (POST insert), `:263-268` (PUT update)
- Test: `apps/api/src/routes/__tests__/admin-kols.test.ts` (new file)

- [ ] **Step 1: 寫失敗的測試**

建立 `apps/api/src/routes/__tests__/admin-kols.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-admin", email: "admin@test.com" } },
    error: null,
  } as any)
}

describe("PUT /admin/kols/:id — recommended_product_ids", () => {
  it("filters out product ids that are not active, preserving order of the rest", async () => {
    mockAdminAuth()

    const updatedKol = {
      id: "kol-1",
      slug: "clairelien",
      name: "Claire Lien",
      recommended_product_ids: ["prod-1", "prod-3"],
    }

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      if (table === "products") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({
            // prod-2 故意不回傳 — 代表它已下架或不存在
            data: [{ id: "prod-1" }, { id: "prod-3" }],
            error: null,
          }),
        } as any
      }
      // kols table
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: updatedKol, error: null }),
      } as any
    })

    const res = await request(app)
      .put("/admin/kols/kol-1")
      .set("Authorization", "Bearer valid-token")
      .send({ recommended_product_ids: ["prod-1", "prod-2", "prod-3"] })

    expect(res.status).toBe(200)
    expect(res.body.data.recommended_product_ids).toEqual(["prod-1", "prod-3"])
  })
})
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd apps/api && npx vitest run src/routes/__tests__/admin-kols.test.ts`
Expected: FAIL —目前 schema 沒有 `recommended_product_ids` 欄位，會被 zod strip 掉或請求驗證錯誤，回傳的 `recommended_product_ids` 會是 `undefined`。

- [ ] **Step 3: 修改 schema**

在 `apps/api/src/routes/admin-kols.ts:38-51` 的 `kolCreateSchema` 裡加一個欄位：

```ts
const kolCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  avatar_url: z.string().url().max(2048).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  instagram_handle: z.string().max(64).optional().nullable(),
  youtube_handle: z.string().max(64).optional().nullable(),
  tiktok_handle: z.string().max(64).optional().nullable(),
  coupon_id: z.string().uuid().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
  commission_rate: z.number().min(0).max(100).optional().default(10),
  is_active: z.boolean().optional().default(true),
  notes: z.string().max(2000).optional().nullable(),
  recommended_product_ids: z.array(z.string().uuid()).optional(),
})
```
（`kolUpdateSchema = kolCreateSchema.partial()` 在下面已經自動繼承，不用另外改。）

- [ ] **Step 4: 加一個驗證 helper，過濾掉不存在/已下架的商品 ID**

在 `aggregateOrders` 函式後面（約第 87 行之後）加一個新 helper：

```ts
// ---------------------------------------------------------------------------
// Helper — filter recommended_product_ids down to existing, active products,
// preserving the caller's ordering (order = display order on /k/[slug]).
// ---------------------------------------------------------------------------

async function filterValidProductIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from("products")
    .select("id")
    .in("id", ids)
    .eq("is_active", true)
    .is("deleted_at", null)

  if (error) throw new Error(error.message)

  const validSet = new Set((data ?? []).map((p) => (p as { id: string }).id))
  return ids.filter((id) => validSet.has(id))
}
```

- [ ] **Step 5: 在 POST（create）套用 filter**

修改 `apps/api/src/routes/admin-kols.ts` 的 `POST /` handler（約第 202-238 行），在 coupon 驗證之後、insert 之前加入：

```ts
adminKolsRouter.post("/", async (req, res) => {
  const parsed = kolCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }

  // If coupon_id supplied, verify it exists.
  if (parsed.data.coupon_id) {
    const { data: coupon } = await supabase
      .from("coupons")
      .select("id")
      .eq("id", parsed.data.coupon_id)
      .maybeSingle()
    if (!coupon) {
      res.status(400).json({ error: "Coupon not found" })
      return
    }
  }

  if (parsed.data.recommended_product_ids) {
    try {
      parsed.data.recommended_product_ids = await filterValidProductIds(
        parsed.data.recommended_product_ids,
      )
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
      return
    }
  }

  const { data, error } = await supabase
    .from("kols")
    .insert(parsed.data)
    .select()
    .single()

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Slug already exists" })
      return
    }
    res.status(500).json({ error: error.message })
    return
  }
  res.status(201).json({ data })
})
```

- [ ] **Step 6: 在 PUT（update）套用同樣的 filter**

修改 `apps/api/src/routes/admin-kols.ts` 的 `PUT /:id` handler（約第 244-283 行），在 coupon 驗證之後、update 之前加入同樣的區塊：

```ts
adminKolsRouter.put("/:id", async (req, res) => {
  const parsed = kolUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() })
    return
  }

  if (parsed.data.coupon_id) {
    const { data: coupon } = await supabase
      .from("coupons")
      .select("id")
      .eq("id", parsed.data.coupon_id)
      .maybeSingle()
    if (!coupon) {
      res.status(400).json({ error: "Coupon not found" })
      return
    }
  }

  if (parsed.data.recommended_product_ids) {
    try {
      parsed.data.recommended_product_ids = await filterValidProductIds(
        parsed.data.recommended_product_ids,
      )
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
      return
    }
  }

  const { data, error } = await supabase
    .from("kols")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single()

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Slug already exists" })
      return
    }
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(404).json({ error: "KOL not found" })
    return
  }
  res.json({ data })
})
```

- [ ] **Step 7: 讓 GET list / GET detail 也回傳這個欄位**

在 `apps/api/src/routes/admin-kols.ts` 把兩處 select 字串（約第 96-100 行的 list、約第 146-150 行的 detail）都加上 `recommended_product_ids`：

```ts
"id, slug, name, avatar_url, bio, instagram_handle, youtube_handle, tiktok_handle, " +
  "coupon_id, user_id, commission_rate, is_active, notes, recommended_product_ids, created_at, updated_at, " +
  "coupons(id, code, type, value)",
```
（兩處都改，list 跟 detail 各一次。）

- [ ] **Step 8: 執行測試確認通過**

Run: `cd apps/api && npx vitest run src/routes/__tests__/admin-kols.test.ts`
Expected: PASS

- [ ] **Step 9: 跑一次全部 apps/api 測試，確認沒有改壞其他東西**

Run: `cd apps/api && npx vitest run`
Expected: 全部 PASS（既有測試不受影響，因為 `recommended_product_ids` 是 optional 欄位）

- [ ] **Step 10: 手動驗證（選做，需要 Task 1 的 migration 已經在正式資料庫執行 + 一組正式站 admin JWT）**

如果手邊沒有現成的 admin JWT，這步可以跳過——Task 5 Step 6 會透過瀏覽器的後台介面（已登入的 admin session）完整測到同一支 PUT endpoint，那時候再一起驗證即可，不必為了這步另外去生一組 JWT。

```bash
curl -s -X PUT "https://api-production-ed3c.up.railway.app/admin/kols/<Claire的kol id>" \
  -H "Authorization: Bearer <admin JWT>" \
  -H "Content-Type: application/json" \
  -d '{"recommended_product_ids": ["<真實存在且上架的商品 id>"]}'
```
Expected: 200，回傳的 `data.recommended_product_ids` 只包含真實存在的商品 ID。

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/routes/admin-kols.ts apps/api/src/routes/__tests__/admin-kols.test.ts
git commit -m "feat(api): accept and validate kols.recommended_product_ids"
```

---

### Task 3: `kols.ts` — 公開 API 依序回傳推薦商品

**重要：`products` 資料表本身沒有 `min_price` / `max_price` / `min_sale_price` / `total_stock` 這幾個欄位。** 這些是 `apps/api/src/routes/products.ts` 裡的私有函式 `enrichProducts()` 從 `product_variants` 表即時算出來的（`GET /products` 就是這樣做的）。`ProductCard`（`apps/web/src/components/catalog/ProductCard.tsx`）會讀這些欄位來顯示價格區間跟是否售完。如果 `kols.ts` 自己選了不存在的欄位或漏算這些值，商品卡片會整組顯示壞掉的價格/庫存狀態。所以這個 Task 要先把 `enrichProducts` 從 `products.ts` 匯出，`kols.ts` 直接重用它，而不是自己重造一次價格計算邏輯。

**Files:**
- Modify: `apps/api/src/routes/products.ts:70` (把 `enrichProducts` 加上 `export`)
- Modify: `apps/api/src/routes/kols.ts:40-104`
- Test: `apps/api/src/routes/__tests__/kols.test.ts` (new file)

- [ ] **Step 1: 把 `enrichProducts` 改成 export**

在 `apps/api/src/routes/products.ts:70`，把：
```ts
async function enrichProducts(products: any[]) {
```
改成：
```ts
export async function enrichProducts(products: any[]) {
```
只加一個關鍵字，不改函式內容，不影響既有行為。

- [ ] **Step 2: 跑一次 products 既有測試，確認這個小改動沒有破壞任何東西**

Run: `cd apps/api && npx vitest run src/routes/__tests__/products.test.ts`
Expected: 全部 PASS（純加 export，行為不變）

- [ ] **Step 3: 寫失敗的測試**

建立 `apps/api/src/routes/__tests__/kols.test.ts`。`enrichProducts` 內部會再查一次 `product_variants` 表，所以 mock 要同時涵蓋 `kols`、`products`、`product_variants` 三張表：

```ts
import { describe, it, expect, vi } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

function mockKolRow(overrides: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "kol-1",
        slug: "clairelien",
        name: "Claire Lien",
        avatar_url: null,
        bio: null,
        instagram_handle: "@theclairelien",
        youtube_handle: null,
        tiktok_handle: null,
        coupons: null,
        recommended_product_ids: [],
        ...overrides,
      },
      error: null,
    }),
  }
}

describe("GET /kols/:slug — products", () => {
  it("returns products in recommended_product_ids order, dropping deactivated ones", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "kols") {
        return mockKolRow({ recommended_product_ids: ["prod-2", "prod-1"] }) as any
      }
      if (table === "products") {
        // prod-2 被下架，查不到 → 之後只剩 prod-1
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({
            data: [
              { id: "prod-1", name: "商品一", slug: "product-1", description: null, category_id: null, images: [], is_active: true, is_featured: false, is_addon: false, display_priority: 0, created_at: new Date().toISOString(), min_tier_id: null },
            ],
            error: null,
          }),
        } as any
      }
      // product_variants — enrichProducts 用來算 min_price / total_stock
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [{ product_id: "prod-1", price: 100, sale_price: null, stock_qty: 5 }],
          error: null,
        }),
      } as any
    })

    const res = await request(app).get("/kols/clairelien")

    expect(res.status).toBe(200)
    expect(res.body.data.products).toHaveLength(1)
    expect(res.body.data.products[0].id).toBe("prod-1")
    expect(res.body.data.products[0].min_price).toBe(100)
  })

  it("returns an empty products array when recommended_product_ids is empty", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "kols") {
        return mockKolRow({
          id: "kol-2",
          slug: "armand",
          name: "Armand",
          instagram_handle: null,
          recommended_product_ids: [],
        }) as any
      }
      // Neither products nor product_variants should be queried when the
      // KOL has no recommended_product_ids — but return empty data if they are.
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      } as any
    })

    const res = await request(app).get("/kols/armand")

    expect(res.status).toBe(200)
    expect(res.body.data.products).toEqual([])
  })
})
```

- [ ] **Step 4: 執行測試確認失敗**

Run: `cd apps/api && npx vitest run src/routes/__tests__/kols.test.ts`
Expected: FAIL — `res.body.data.products` 現在是 `undefined`（route 還沒有這個欄位）。

- [ ] **Step 5: 修改 `apps/api/src/routes/kols.ts`**

在檔案最上面的 import 加一行，然後把整個 `GET /:slug` handler（第 33-104 行）換成：

```ts
import { Router } from "express"
import { createHash } from "crypto"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { optionalAuth } from "../middleware/auth"
import { enrichProducts } from "./products"
```

```ts
kolsRouter.get("/:slug", async (req, res) => {
  const slug = String(req.params.slug ?? "").trim().toLowerCase()
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(404).json({ error: "KOL not found" })
    return
  }

  const { data, error } = await supabase
    .from("kols")
    .select(
      "id, slug, name, avatar_url, bio, instagram_handle, youtube_handle, tiktok_handle, " +
        "coupon_id, commission_rate, is_active, recommended_product_ids, " +
        "coupons(id, code, type, value)",
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle()

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  if (!data) {
    res.status(404).json({ error: "KOL not found" })
    return
  }
  // Supabase types narrow imperfectly with join embeds — narrow manually.
  const kol = data as unknown as {
    id: string
    slug: string
    name: string
    avatar_url: string | null
    bio: string | null
    instagram_handle: string | null
    youtube_handle: string | null
    tiktok_handle: string | null
    recommended_product_ids: string[] | null
    coupons?: unknown
  }

  type CouponRow = {
    id: string
    code: string
    type: "percentage" | "fixed"
    value: number | string
  }

  const couponRaw = kol.coupons as CouponRow | CouponRow[] | null | undefined
  const coupon = Array.isArray(couponRaw) ? (couponRaw[0] ?? null) : couponRaw ?? null

  // Fetch this KOL's recommended products. Reuses the same enrichProducts()
  // helper GET /products uses, so these objects carry min_price / max_price /
  // min_sale_price / total_stock exactly like every other product card on
  // the site — those aren't real columns on `products`, they're computed
  // from product_variants. Products deactivated/deleted after being picked
  // are silently dropped (admin picker already filters on write; this
  // covers drift since then). Order is re-applied after the fetch because
  // Supabase's `.in()` does not preserve the input array's ordering.
  const productIds = kol.recommended_product_ids ?? []
  let products: Array<Record<string, unknown> & { id: string }> = []
  if (productIds.length > 0) {
    const { data: productRows } = await supabase
      .from("products")
      .select(
        "id, name, slug, description, category_id, images, is_active, is_featured, " +
          "is_addon, display_priority, created_at, min_tier_id, " +
          "membership_tiers!min_tier_id(id, name, min_spend)",
      )
      .in("id", productIds)
      .eq("is_active", true)
      .is("deleted_at", null)

    const enriched = await enrichProducts(productRows ?? [])
    const byId = new Map(
      (enriched as Array<{ id: string }>).map((p) => [p.id, p]),
    )
    products = productIds
      .map((id) => byId.get(id))
      .filter((p): p is Record<string, unknown> & { id: string } => Boolean(p))
  }

  res.json({
    data: {
      id: kol.id,
      slug: kol.slug,
      name: kol.name,
      avatar_url: kol.avatar_url,
      bio: kol.bio,
      socials: {
        instagram: kol.instagram_handle,
        youtube: kol.youtube_handle,
        tiktok: kol.tiktok_handle,
      },
      coupon: coupon
        ? {
            id: coupon.id,
            code: coupon.code,
            type: coupon.type,
            value: Number(coupon.value),
          }
        : null,
      products,
    },
  })
})
```

- [ ] **Step 6: 執行測試確認通過**

Run: `cd apps/api && npx vitest run src/routes/__tests__/kols.test.ts`
Expected: PASS

- [ ] **Step 7: 跑一次全部 apps/api 測試**

Run: `cd apps/api && npx vitest run`
Expected: 全部 PASS

- [ ] **Step 8: 手動驗證（需要 Task 2 已經在正式站幫 Claire 設定過 recommended_product_ids）**

```bash
curl -s "https://api-production-ed3c.up.railway.app/kols/clairelien" | python -m json.tool
```
Expected: `data.products` 是一個陣列，每個商品物件裡有 `min_price`（不是 `undefined`），內容跟後台勾選的商品、順序一致。

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/products.ts apps/api/src/routes/kols.ts apps/api/src/routes/__tests__/kols.test.ts
git commit -m "feat(api): return per-KOL recommended products from GET /kols/:slug"
```

---

### Task 4: 後台商品勾選＋排序元件

**Files:**
- Create: `apps/web/src/app/admin/kols/RecommendedProductsPicker.tsx`

> 注意：`apps/web/src/app/admin/campaigns/_pickers/ProductPicker.tsx` 已經存在，但那是「單選 + 打字搜尋」的元件，用途不同（campaign 折扣規則挑單一商品）。這裡刻意取不同檔名 `RecommendedProductsPicker`，避免跟既有元件混淆。

- [ ] **Step 1: 寫元件**

```tsx
"use client"

import { useEffect, useState } from "react"
import Image from "next/image"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

interface ProductRow {
  id: string
  name: string
  images: string[] | null
  category_id: string | null
}

interface CategoryRow {
  id: string
  name: string
}

interface Props {
  name: string
  defaultValue?: string[]
}

/**
 * Multi-select + reorderable picker for a KOL's recommended products.
 *
 * Fetches all active products (GET /products?limit=100, public endpoint —
 * already filters is_active=true) and categories on mount, renders a
 * checklist grouped by category, plus a reorderable "已選商品" strip with
 * ▲▼ buttons. Emits the ordered id list via a hidden input so the
 * surrounding <form> (native FormData submission, same pattern as
 * CouponPicker) picks it up under `name`.
 */
export function RecommendedProductsPicker({ name, defaultValue = [] }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [selected, setSelected] = useState<string[]>(defaultValue)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_URL}/products?limit=100`).then((r) => (r.ok ? r.json() : { data: [] })),
      fetch(`${API_URL}/categories`).then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([productsJson, categoriesJson]) => {
        if (cancelled) return
        setProducts(productsJson?.data ?? [])
        setCategories(categoriesJson?.data ?? [])
      })
      .catch(() => {
        if (!cancelled) {
          setProducts([])
          setCategories([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSelected(defaultValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue.join(",")])

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function move(id: string, dir: -1 | 1) {
    setSelected((prev) => {
      const idx = prev.indexOf(id)
      const next = idx + dir
      if (idx === -1 || next < 0 || next >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
      return copy
    })
  }

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "未分類"

  const grouped = products.reduce<Record<string, ProductRow[]>>((acc, p) => {
    const key = categoryName(p.category_id)
    ;(acc[key] ??= []).push(p)
    return acc
  }, {})

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={selected.join(",")} />

      {loading ? (
        <p className="text-xs text-zinc-400">載入商品清單中…</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-input p-3 space-y-3">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-xs font-semibold text-zinc-500 mb-1">{category}</p>
              <div className="space-y-1">
                {items.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    {p.images?.[0] && (
                      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded bg-zinc-100">
                        <Image src={p.images[0]} alt="" fill sizes="32px" className="object-cover" unoptimized />
                      </span>
                    )}
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-zinc-500">已選商品（顯示順序）</p>
          <ul className="space-y-1">
            {selected.map((id, idx) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border border-input px-2 py-1 text-sm"
              >
                <span>{idx + 1}. {productName(id)}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(id, -1)}
                    disabled={idx === 0}
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-30"
                    aria-label="上移"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(id, 1)}
                    disabled={idx === selected.length - 1}
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-30"
                    aria-label="下移"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                    aria-label="移除"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 無錯誤（這個檔案目前還沒被任何頁面 import，typecheck 只是確認元件本身型別正確）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/kols/RecommendedProductsPicker.tsx
git commit -m "feat(admin): add RecommendedProductsPicker component"
```

---

### Task 5: 接進 KOL 編輯表單

**Files:**
- Modify: `apps/web/src/app/admin/kols/[id]/_client.tsx:43` (import), `:54-99` (KolDetailData type), `:387-416` (handleSubmit), `:504-519` (form JSX)
- Modify: `apps/web/src/app/admin/kols/[id]/actions.ts:19-47` (KolUpsertInput / KolUpdateInput)

- [ ] **Step 1: `actions.ts` 加欄位**

在 `apps/web/src/app/admin/kols/[id]/actions.ts` 的兩個 interface 都加一行：

```ts
export interface KolUpsertInput {
  slug: string
  name: string
  bio: string | null
  avatar_url: string | null
  instagram_handle: string | null
  youtube_handle: string | null
  tiktok_handle: string | null
  coupon_id: string | null
  user_id: string | null
  commission_rate: number
  is_active: boolean
  notes?: string | null
  recommended_product_ids?: string[]
}

export interface KolUpdateInput {
  slug?: string
  name?: string
  bio?: string | null
  avatar_url?: string | null
  instagram_handle?: string | null
  youtube_handle?: string | null
  tiktok_handle?: string | null
  coupon_id?: string | null
  user_id?: string | null
  commission_rate?: number
  is_active?: boolean
  notes?: string | null
  recommended_product_ids?: string[]
}
```

- [ ] **Step 2: `_client.tsx` — import + type**

在 `apps/web/src/app/admin/kols/[id]/_client.tsx:43` 附近加 import：

```ts
import { CouponPicker } from "../CouponPicker"
import { RecommendedProductsPicker } from "../RecommendedProductsPicker"
```

在 `KolDetailData` interface（第 54-99 行）裡加一行（放在 `notes` 之後即可）：

```ts
export interface KolDetailData {
  id: string
  slug: string
  name: string
  avatar_url: string | null
  bio: string | null
  instagram_handle: string | null
  youtube_handle: string | null
  tiktok_handle: string | null
  coupon_id: string | null
  user_id: string | null
  commission_rate: number | string
  is_active: boolean
  notes: string | null
  recommended_product_ids?: string[] | null
  created_at: string
  // ...（其餘欄位不變）
```

- [ ] **Step 3: `handleSubmit` 讀取隱藏欄位**

修改 `apps/web/src/app/admin/kols/[id]/_client.tsx:387-416` 的 `handleSubmit`：

```ts
function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault()
  const fd = new FormData(e.currentTarget)
  const recommendedRaw = (fd.get("recommended_product_ids") as string) || ""
  const input: KolUpdateInput = {
    slug: ((fd.get("slug") as string) || "").trim().toLowerCase(),
    name: ((fd.get("name") as string) || "").trim(),
    bio: ((fd.get("bio") as string) || "").trim() || null,
    avatar_url: ((fd.get("avatar_url") as string) || "").trim() || null,
    instagram_handle:
      ((fd.get("instagram_handle") as string) || "").trim() || null,
    youtube_handle:
      ((fd.get("youtube_handle") as string) || "").trim() || null,
    tiktok_handle: ((fd.get("tiktok_handle") as string) || "").trim() || null,
    coupon_id: ((fd.get("coupon_id") as string) || "").trim() || null,
    user_id: ((fd.get("user_id") as string) || "").trim() || null,
    commission_rate: Number(fd.get("commission_rate")) || 0,
    is_active: fd.get("is_active") === "on",
    notes: ((fd.get("notes") as string) || "").trim() || null,
    recommended_product_ids: recommendedRaw
      ? recommendedRaw.split(",").filter(Boolean)
      : [],
  }

  startTransition(async () => {
    try {
      await updateKolAction(kolId, input)
      toast.success("KOL 已更新")
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失敗")
    }
  })
}
```

- [ ] **Step 4: 表單 JSX 加入元件**

在 `apps/web/src/app/admin/kols/[id]/_client.tsx:504-519` 附近，`CouponPicker` 的 div 之後、`user_id` 欄位之前，插入一個新的全寬區塊：

```tsx
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">綁定 coupon</Label>
              <CouponPicker name="coupon_id" defaultValue={kol.coupon_id ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2 md:col-span-3">
              <Label className="text-xs">推薦商品</Label>
              <RecommendedProductsPicker
                name="recommended_product_ids"
                defaultValue={kol.recommended_product_ids ?? []}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2 md:col-span-3">
              <Label htmlFor="f-user-id" className="text-xs">
                綁定使用者帳號 ID（用於排除自買佣金）
              </Label>
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 6: 手動驗證（需要 Task 1-3 都已在正式站/本機 API 生效）**

啟動 dev server（或用正式站後台），開 `/admin/kols/<Claire的id>`：
1. 確認「推薦商品」區塊有出現，商品依分類分組列出
2. 勾選 3-5 樣商品，確認下方「已選商品」清單即時更新
3. 用 ▲▼ 調整順序，確認順序真的變了
4. 按「儲存變更」，確認 toast 顯示「KOL 已更新」
5. 重新整理頁面，確認剛才勾選的商品跟順序都還在（代表有正確存回資料庫）

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/admin/kols/[id]/_client.tsx apps/web/src/app/admin/kols/[id]/actions.ts
git commit -m "feat(admin): wire RecommendedProductsPicker into KOL edit form"
```

---

### Task 6: 前台 `/k/[slug]` 頁面改吃 KOL 專屬商品

**Files:**
- Modify: `apps/web/src/app/k/[slug]/page.tsx:18-64` (type + 移除 getFeaturedProducts), `:82-96` (KolLandingPage)

- [ ] **Step 1: 修改 `page.tsx`**

把整個檔案的 `Kol` type、`getFeaturedProducts`、`KolLandingPage` 改成：

```ts
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import type { Product } from "@/lib/catalog"
import { KolLandingClient } from "./_client"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

/**
 * KOL landing page  —  /k/<slug>
 *
 * Spec: docs/superpowers/specs/2026-05-31-I-kol-affiliate-design.md (Section 5).
 * Recommended-products behaviour updated per
 * docs/superpowers/specs/2026-07-28-kol-recommended-products-design.md —
 * products now come from the KOL's own `recommended_product_ids`
 * (already resolved server-side by GET /kols/:slug), not a global
 * is_featured fetch.
 *
 * Server component: fetch the public KOL record (which now includes its
 * recommended products) and pass everything to <KolLandingClient /> for
 * rendering and the fire-and-forget click-tracking POST.
 */

export type KolCoupon = {
  id: string
  code: string
  type: "percentage" | "fixed"
  value: number
}

export type Kol = {
  id: string
  slug: string
  name: string
  avatar_url: string | null
  bio: string | null
  socials: {
    instagram: string | null
    youtube: string | null
    tiktok: string | null
  }
  coupon: KolCoupon | null
  products: Product[]
}

async function getKol(slug: string): Promise<Kol | null> {
  try {
    const res = await fetch(`${API_URL}/kols/${encodeURIComponent(slug)}`, {
      // Landing pages should reflect admin edits quickly; small revalidate window.
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { data?: Kol }
    return json.data ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const kol = await getKol(slug)
  if (!kol) {
    return { title: "KOL not found" }
  }
  return {
    title: `${kol.name} — 誠真生活 RealReal 專屬連結`,
    description: kol.bio ?? `透過 ${kol.name} 的專屬連結進入誠真生活 RealReal，享受 KOL 限定折扣。`,
  }
}

export default async function KolLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const kol = await getKol(slug)
  if (!kol) {
    notFound()
  }

  return <KolLandingClient kol={kol} products={kol.products} />
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 目前應該還會出錯——`KolLandingClient` 的 props 型別（`products: Product[]`）沒變，但 `_client.tsx` 裡還沾著舊的空狀態文案；型別本身應該過，先確認沒有型別錯誤，行為留到 Task 7 修。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/k/\[slug\]/page.tsx
git commit -m "feat(kol-landing): source recommended products from KOL record"
```

---

### Task 7: 空清單時整個「推薦商品」區塊不顯示

**Files:**
- Modify: `apps/web/src/app/k/[slug]/_client.tsx:186-208`

- [ ] **Step 1: 修改 `_client.tsx`**

把整個「推薦商品」`<section>`（第 186-208 行）從：

```tsx
        {/* ====================== Recommended products ====================== */}
        <section className="mt-12">
          <h2
            className="text-2xl font-bold text-center mb-2 tracking-tight"
            style={{ color: BRAND }}
          >
            {kol.name} 推薦商品
          </h2>
          <p className="text-center text-sm mb-8" style={{ color: "#687279" }}>
            精選熱賣商品，立即下單享 KOL 專屬折扣
          </p>

          {products.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-12">
              暫無推薦商品
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {products.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
```

改成：

```tsx
        {/* ====================== Recommended products ====================== */}
        {/* Spec 2026-07-28: hide the whole section (incl. heading) when this
            KOL has no recommended_product_ids set, instead of showing an
            empty-state message. */}
        {products.length > 0 && (
          <section className="mt-12">
            <h2
              className="text-2xl font-bold text-center mb-2 tracking-tight"
              style={{ color: BRAND }}
            >
              {kol.name} 推薦商品
            </h2>
            <p className="text-center text-sm mb-8" style={{ color: "#687279" }}>
              精選熱賣商品，立即下單享 KOL 專屬折扣
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {products.map(product => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </section>
        )}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 3: 手動驗證**

1. 開 `/k/clairelien`（Claire 在 Task 5 已經勾了商品）：確認「推薦商品」標題 + 商品格子都有出現，商品跟順序符合後台勾選的內容
2. 開 `/k/armand`（或任何還沒去後台勾選商品的既有 KOL slug）：確認頁面上完全沒有「推薦商品」標題、沒有空清單文字，直接跳過那個區塊

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/k/\[slug\]/_client.tsx
git commit -m "feat(kol-landing): hide recommended-products section when empty"
```

---

### Task 8: 整體收尾驗證

**Files:** 無新修改，純驗證

- [ ] **Step 1: 全專案 typecheck**

```bash
cd apps/api && npx tsc --noEmit
cd ../web && npx tsc --noEmit
```
Expected: 兩邊都無錯誤

- [ ] **Step 2: 全部自動化測試**

```bash
cd apps/api && npx vitest run
```
Expected: 全部 PASS（含 Task 2、Task 3 新增的測試）

- [ ] **Step 3: 依規格文件「測試 / 驗收方式」章節逐項手動核對**

對照 `docs/superpowers/specs/2026-07-28-kol-recommended-products-design.md` 的驗收清單，逐項在正式站確認：
1. 後台勾選 Claire 3-5 樣商品、調整順序、儲存 ✅（Task 5 已做過，這裡重新確認一次最終狀態）
2. 開 `/k/clairelien`，確認只顯示勾選的商品、順序正確 ✅（Task 7 已驗證）
3. 開一個尚未設定的 KOL 頁面，確認「推薦商品」區塊整個不出現 ✅（Task 7 已驗證）
4. 後台把 Claire 其中一樣商品下架，重新整理 `/k/clairelien`，確認該商品自動從列表消失、頁面不報錯

- [ ] **Step 4: 推送**

```bash
git push
```

- [ ] **Step 5: 跟使用者回報完成**

告知：Claire 的推薦商品頁面已經可以在後台獨立設定，數量不受 8 筆限制；其他既有 KOL（尚未設定的）頁面上的「推薦商品」區塊會先不顯示，等之後個別去後台勾選。
