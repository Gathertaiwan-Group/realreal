/**
 * One-time seed: create "真實見證" post category + 阿雯 testimonial post.
 *
 * Usage (from repo root):
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   npx ts-node -P apps/api/tsconfig.json apps/api/scripts/seed-testimonial.ts
 *
 * Or copy your Railway env vars into a .env file and use dotenv-cli:
 *   dotenv -e apps/api/.env -- npx ts-node -P apps/api/tsconfig.json apps/api/scripts/seed-testimonial.ts
 */

import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const CATEGORY_NAME = "真實見證"
const CATEGORY_SLUG = "testimonials"

const POST_SLUG = "awan-testimonial"
const POST_TITLE = "阿雯｜農忙與育兒之間，給自己一杯喘息的時間"

const POST_CONTENT_HTML = `
<div style="background:#f8f7f4;border-radius:16px;padding:1.5rem 2rem;margin-bottom:2rem;display:flex;flex-direction:column;gap:0.75rem;">
  <div style="display:flex;align-items:center;gap:1rem;">
    <img
      src="/testimonials/阿雯.jpg"
      alt="阿雯"
      style="width:90px;height:90px;border-radius:50%;object-fit:cover;flex-shrink:0;"
    />
    <div>
      <p style="font-size:1.1rem;font-weight:700;color:#10305a;margin:0;">阿雯</p>
      <p style="font-size:0.9rem;color:#687279;margin:0.2rem 0 0;">40 歲・農婦</p>
    </div>
  </div>
  <div style="border-top:1px solid #e5e0d8;padding-top:0.75rem;">
    <p style="font-size:0.8rem;font-weight:600;color:#10305a;margin:0 0 0.25rem;text-transform:uppercase;letter-spacing:.08em;">喜歡的口味</p>
    <p style="font-size:0.9rem;color:#687279;margin:0;">草莓 · 可可</p>
  </div>
</div>

<figure style="margin:0 0 2rem;">
  <img
    src="/testimonials/阿雯.jpg"
    alt="阿雯與孩子的日常"
    style="width:100%;border-radius:12px;object-fit:cover;"
  />
</figure>

<p>喜歡它成分單純、不甜膩的口感。</p>

<p>每天早上是最忙碌的時候，孩子在腳邊吵鬧，家事、農事、一堆待辦清單接連等著處理，肚子很餓的時候面對兵荒馬亂！誠真生活就是我的支援救兵！趕緊泡一杯，讓自己有餘裕迎接一天的挑戰。</p>

<blockquote>
  <p>留心生活中的善意，<br/>就能在平凡的日子裡，<br/>借這一點光，繼續前進。</p>
</blockquote>
`.trim()

const POST_EXCERPT = "農婦阿雯分享：「誠真生活就是我的支援救兵！」每天早上在兵荒馬亂中，一杯真實見證了日常裡的喘息與力量。"

async function run() {
  // 1. Find or create post category
  console.log(`\n📂 確認分類：${CATEGORY_NAME}`)
  let categoryId: string

  const { data: existingCat } = await supabase
    .from("post_categories")
    .select("id, name")
    .eq("name", CATEGORY_NAME)
    .maybeSingle()

  if (existingCat) {
    categoryId = existingCat.id
    console.log(`   ✓ 分類已存在 (${categoryId})`)
  } else {
    const { data: newCat, error: catErr } = await supabase
      .from("post_categories")
      .insert({ name: CATEGORY_NAME, slug: CATEGORY_SLUG })
      .select()
      .single()

    if (catErr || !newCat) {
      console.error("❌ 建立分類失敗：", catErr?.message)
      process.exit(1)
    }
    categoryId = newCat.id
    console.log(`   ✓ 分類已建立 (${categoryId})`)
  }

  // 2. Check if post already exists
  console.log(`\n📝 確認文章：${POST_TITLE}`)

  const { data: existingPost } = await supabase
    .from("posts")
    .select("id, slug")
    .eq("slug", POST_SLUG)
    .maybeSingle()

  if (existingPost) {
    console.log(`   ⚠️  文章已存在 (slug: ${POST_SLUG})，跳過。`)
    console.log("\n✅ 完成（無需更新）")
    return
  }

  // 3. Create post
  const { data: newPost, error: postErr } = await supabase
    .from("posts")
    .insert({
      id: randomUUID(),
      title: POST_TITLE,
      slug: POST_SLUG,
      excerpt: POST_EXCERPT,
      content_html: POST_CONTENT_HTML,
      cover_image: "/testimonials/阿雯.jpg",
      category_id: categoryId,
      status: "published",
      published_at: new Date().toISOString(),
      seo_title: `${POST_TITLE} | 真實見證`,
      seo_description: POST_EXCERPT,
    })
    .select()
    .single()

  if (postErr || !newPost) {
    console.error("❌ 建立文章失敗：", postErr?.message)
    process.exit(1)
  }

  console.log(`   ✓ 文章已建立 (id: ${newPost.id})`)
  console.log(`   🔗 路徑：/blog/${POST_SLUG}`)
  console.log("\n✅ 完成！")
  console.log(`\n前往 /blog 查看「真實見證」分類，或直接瀏覽：/blog/${POST_SLUG}`)
}

run().catch(err => {
  console.error("❌ 未預期錯誤：", err)
  process.exit(1)
})
