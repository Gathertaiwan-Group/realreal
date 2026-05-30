# Spec J — 分類頁 UI 重設計（仿 realreal.cc/fruit-shop 風格）

**Date:** 2026-05-31
**Status:** Draft → ready for implementation
**Touches:** packages/db (1 migration), apps/api (1 route patched), apps/web (1 category landing component rewrite + 1 reusable hero/feature component)
**Scope:** medium — ~600 LOC

## Why

User 截圖 → 目前 `/shop` 過濾「永續生活」分類顯示：
- 標題 + 「共 N 件商品」
- tab 切分類
- 商品 grid
- 排序下拉

**太單調**。比對 reference https://realreal.cc/fruit-shop/（舊站 WordPress 版）：
- Banner image (full-width hero)
- 中文 tagline 大字（「為你的笑容，鎖住每一口純粹」）+ 副標
- 3 個 benefit blocks（H2 + 段落，講分類核心賣點）
- 商品 grid (同 spec B)
- 底部「大家都在看」4 個 blog cards

User want：每個分類頁有自己的 banner + tagline + 3 賣點 + blog 推薦，且**有動畫效果**（scroll-triggered fade-in / slide-up）。

## Locked decisions
- 加 schema：categories 加 `banner_url, tagline, subtitle, feature_blocks JSONB, related_post_slugs TEXT[]`
- 動畫：純 Tailwind + CSS transition (intersection-observer 觸發)；**不引入 framer-motion / gsap 等重 lib**
- Banner 圖片 + tagline 一律 admin 可在 /admin/categories 編輯
- 既有 /shop?category=X URL 維持運作；landing 是 enhanced view on top
- 「大家都在看」blog cards = 該分類最近 4 篇 post（用 spec F 已建的文章分類 join）

## Scope

### IN
1. Migration 0024 — categories 加 5 個 column (banner_url / tagline / subtitle / feature_blocks JSONB / related_post_slugs TEXT[])
2. `apps/api/src/routes/categories.ts` — GET /categories/:slug (public) return full data + product_count + recent 4 blog posts
3. `/admin/categories/_client.tsx` (spec A 建好) — 加可摺疊「Landing 頁設定」section：banner upload + tagline + subtitle + feature_blocks (3-row editor) + related post picker
4. `apps/web/src/app/shop/[category]/page.tsx` (new) — category landing page with hero + features + product grid + blog cards
5. New `apps/web/src/components/category/CategoryHero.tsx` — banner + tagline (fade-in animation on mount)
6. New `apps/web/src/components/category/FeatureBlocks.tsx` — 3 blocks (scroll-triggered slide-up via intersection-observer)
7. /shop?category= 仍 work（向後相容），但新 URL `/shop/<slug>` 顯示豐富 landing 頁
8. 既有 fruit-shop 內容 backfill 進 freeze-dried 分類（tagline + 3 blocks 一字不差搬過去）

### OUT
- Per-category SEO meta tags（v2）
- 影片 banner（純圖片）
- AOS / framer-motion 等重 animation lib
- 分類專屬的「主打商品」(spec B 的 is_featured 是 global)
- Related products carousel（用 product grid 已足夠）

## Design

### Section 1 — Migration 0024

`packages/db/migrations/0024_category_landing_fields.sql`:
```sql
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS banner_url TEXT,
  ADD COLUMN IF NOT EXISTS tagline TEXT,          -- main hero 大字 e.g. "為你的笑容，鎖住每一口純粹"
  ADD COLUMN IF NOT EXISTS subtitle TEXT,         -- 副標 e.g. "孩子的笑容，是世界上最純粹的能量。"
  ADD COLUMN IF NOT EXISTS feature_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- shape: [{ "heading": "...", "body": "..." }, ...] up to 3 entries
  ADD COLUMN IF NOT EXISTS related_post_slugs TEXT[] NOT NULL DEFAULT '{}';
  -- explicit post slug list; if empty, fallback to recent 4 posts WHERE category matches

-- Backfill freeze-dried 凍乾水果 per realreal.cc/fruit-shop content
UPDATE categories SET
  tagline = '為你的笑容，鎖住每一口純粹',
  subtitle = '孩子的笑容，是世界上最純粹的能量。',
  feature_blocks = '[
    {"heading": "每一片水果，都是自然的禮物", "body": "採用低溫凍乾技術，鎖住維生素與膳食纖維，零添加物、零香料，每一口都是水果本身的甘甜。"},
    {"heading": "全年齡皆宜的快樂零食", "body": "從早餐果碗、健身點心，到露營與登山補給，凍乾水果是各種場景的營養好夥伴。"},
    {"heading": "先進凍乾技術，完整鎖住營養", "body": "獨家凍乾工藝在保留新鮮口感的同時，最大化保存水果原有的維生素與礦物質。"}
  ]'::jsonb
WHERE slug = 'freeze-dried';
```

### Section 2 — Backend

`apps/api/src/routes/categories.ts` 新 endpoint:
```ts
// GET /categories/:slug — public, full landing data
categoriesRouter.get("/categories/:slug", async (req, res) => {
  const { data: category } = await supabase
    .from("categories")
    .select("*")
    .eq("slug", req.params.slug)
    .single()
  if (!category) return res.status(404).json({ error: "Category not found" })

  // Fetch related posts: explicit slugs if provided, else recent 4 in matching post_category
  let posts: any[] = []
  if (category.related_post_slugs && category.related_post_slugs.length > 0) {
    const { data } = await supabase
      .from("posts")
      .select("slug, title, excerpt, cover_image, published_at")
      .in("slug", category.related_post_slugs)
      .limit(4)
    posts = data ?? []
  } else {
    // Fallback: match post_category by name OR most recent any
    const { data } = await supabase
      .from("posts")
      .select("slug, title, excerpt, cover_image, published_at, post_categories(slug)")
      .order("published_at", { ascending: false })
      .limit(4)
    posts = data ?? []
  }

  res.json({ category, posts })
})
```

### Section 3 — Admin UI 補 Landing 設定區

`/admin/categories/_client.tsx`（spec A 已建）— 每 row 加可摺疊 `<details>`「Landing 頁設定」：
- Banner 圖片：reuse `ProductImageUpload` 或簡化 url input
- Tagline TEXT (一行)
- Subtitle TEXT (一行)
- Feature Blocks：3 個 (heading + body) 編輯區，可拖排序
- Related Posts：multi-select 從 GET /posts 拉，可選最多 4 個

### Section 4 — Landing page

`apps/web/src/app/shop/[category]/page.tsx` (server):
```tsx
import { CategoryHero } from "@/components/category/CategoryHero"
import { FeatureBlocks } from "@/components/category/FeatureBlocks"
import { ProductGrid } from "@/components/catalog/ProductGrid"
import { RelatedPosts } from "@/components/category/RelatedPosts"

export default async function CategoryLandingPage({ params }: { params: { category: string } }) {
  const { category, posts } = await fetch(`${API_URL}/categories/${params.category}`).then(r => r.json())
  const { data: products } = await fetch(`${API_URL}/products?category_slug=${params.category}`).then(r => r.json())

  return (
    <>
      <CategoryHero
        bannerUrl={category.banner_url}
        tagline={category.tagline ?? category.name}
        subtitle={category.subtitle}
      />
      {category.feature_blocks?.length > 0 && (
        <FeatureBlocks blocks={category.feature_blocks} />
      )}
      <section className="mx-auto max-w-7xl px-4 py-12">
        <h2 className="text-2xl font-semibold text-[#10305a] mb-6">{category.name}</h2>
        <ProductGrid products={products ?? []} />
      </section>
      {posts.length > 0 && <RelatedPosts heading="大家都在看" posts={posts} />}
    </>
  )
}
```

### Section 5 — Animation 元件

`apps/web/src/components/category/CategoryHero.tsx`:
- "use client"
- `<section className="relative w-full">` with background image from `banner_url` (Next.js Image fill)
- `<div className="absolute inset-0 bg-black/30">` overlay for text legibility
- Tagline + subtitle centered, white text
- Mount animation: opacity 0 → 1 over 600ms (CSS transition + useEffect setState)

`FeatureBlocks.tsx`:
- Grid 1 col mobile / 3 col desktop
- Each block uses `IntersectionObserver` to add `opacity-100 translate-y-0` when entering viewport (initial: `opacity-0 translate-y-6`)
- Pure Tailwind transition classes; no external lib

Reusable hook `apps/web/src/lib/use-in-view.ts`:
```ts
import { useEffect, useRef, useState } from "react"

export function useInView(threshold = 0.1) {
  const ref = useRef<HTMLElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        observer.disconnect()
      }
    }, { threshold })
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])
  return { ref, inView }
}
```

### Section 6 — Sidebar nav redirect

The current `/shop?category=X` should redirect or co-exist:
- If user lands at `/shop?category=freeze-dried` → redirect to `/shop/freeze-dried` (canonical URL)
- Or: keep both, but `/shop/[slug]` is the landing view, `/shop` without param shows the full all-categories grid

Pick: keep both. `/shop` = all products list (current behavior); `/shop/<slug>` = category landing.

Update internal links (category tabs in /shop page, footer, navigation) to use `/shop/<slug>` form.

## File summary

| 動作 | 路徑 |
|---|---|
| 新 | `packages/db/migrations/0024_category_landing_fields.sql` |
| 改 | `apps/api/src/routes/categories.ts` (新 GET /categories/:slug) |
| 改 | `apps/web/src/app/admin/categories/_client.tsx` (加 Landing 設定區) |
| 新 | `apps/web/src/app/shop/[category]/page.tsx` |
| 新 | `apps/web/src/components/category/CategoryHero.tsx` |
| 新 | `apps/web/src/components/category/FeatureBlocks.tsx` |
| 新 | `apps/web/src/components/category/RelatedPosts.tsx` |
| 新 | `apps/web/src/lib/use-in-view.ts` (intersection observer hook) |
| 改 | `apps/web/src/app/shop/page.tsx` (category tab href 改用 `/shop/<slug>`) |

預估 ~500 LOC 新增 / ~100 LOC 修改 / 1 migration

## Validation

1. `tsc` / `next build` 雙綠
2. Migration 0024 套用：categories 多 5 個欄；freeze-dried row tagline + feature_blocks 正確 backfill
3. 訪問 https://realreal-store.vercel.app/shop/freeze-dried → 看到 fruit-shop-style 頁面：banner (若 admin 已上傳) + tagline + 3 features + product grid + recent 4 blog cards
4. 滾動頁面 — feature blocks 進 viewport 時 slide-up + fade-in 動畫
5. admin 進 /admin/categories 任一 row 展開 「Landing 頁設定」→ 編輯 tagline + features + 存後 → 重新整理前台應更新

## Known caveats

- v1 banner 圖片用 `<img>` (server-rendered, no Next.js Image optimization for external URL)。若以後加 Supabase Storage 上傳 → 換 Next Image。
- IntersectionObserver 在舊 Safari (< 12.1) 不支援 — Next.js polyfill 有，無需處理。
- feature_blocks 上限 3 個非 DB constraint，admin UI 上限制 max 3 row。
- /shop/<slug> 動態路由與既有 /shop/[product] 商品詳細頁可能撞 — verify route 結構，必要時用 `/category/<slug>` 替代或加 catch-all。
- Backfill 僅針對 freeze-dried；其他既有分類（蛋白粉、永續生活、禮物）admin 須自己進去填 tagline + features，否則 hero 沒 banner 但 title 仍顯示。
- 「大家都在看」當分類無 related_post_slugs 又無 matching post_categories → fallback 取全站最近 4 篇；可接受 (空狀態 = 隱藏整 section)。
