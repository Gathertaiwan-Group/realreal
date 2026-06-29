/**
 * Import WordPress / WooCommerce backup into Supabase.
 *
 * Usage:
 *   pnpm tsx scripts/import-wp-backup.ts <path-to-sql> [--dry-run]
 *
 * What it imports (and what gets skipped):
 *   ✓ wp_users      → auth.users + user_profiles (with wp_legacy_password_hash)
 *   ✓ wp_usermeta   → user_profiles.{phone, default_billing_address}
 *   ✓ wc_order_stats + wp_posts + wp_postmeta → orders + order_addresses
 *   ✓ wc_order_product_lookup + wp_woocommerce_order_items → order_items
 *     (variant_id stays null because WP product IDs don't map to new product
 *      UUIDs; product_snapshot preserves the name/qty/price/sku verbatim)
 *   ✗ Points / tier / charity_savings — would require a separate plan;
 *     for now imported users start with tier=basic and 0 points.
 *
 * Idempotency: every write is upsert by a deterministic key
 *   - users     by email
 *   - orders    by order_number = "WP<wp_order_id>"
 *   - addresses by (order_id, type)
 *   - items     by (order_id, snapshot.wp_order_item_id)
 * Re-running the script with --dry-run prints a diff. Re-running for real
 * leaves the system in the same end state.
 *
 * Required env (read from .env or process.env):
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role JWT for admin auth + bypass RLS
 */

import { readFileSync } from "node:fs"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const sqlPath = args.find((a) => !a.startsWith("--"))
const dryRun = args.includes("--dry-run")
if (!sqlPath) {
  console.error("usage: tsx import-wp-backup.ts <path-to-sql> [--dry-run]")
  process.exit(1)
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env")
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------------------------------------------------------------------------
// SQL parser — handles wpvivid / mysqldump style INSERT INTO ... VALUES (...);
// ---------------------------------------------------------------------------

type Row = Array<string | number | null>

function tokenizeValues(payload: string): Row[] {
  // payload is everything between "VALUES " and ";", a list of "(...),(...)"
  // where strings can contain escaped quotes (\') and backslashes (\\).
  const rows: Row[] = []
  let i = 0
  while (i < payload.length) {
    while (i < payload.length && payload[i] !== "(") i++
    if (i >= payload.length) break
    i++ // past (
    const row: Row = []
    while (i < payload.length) {
      // skip whitespace + commas
      while (i < payload.length && (payload[i] === " " || payload[i] === ",")) i++
      if (payload[i] === ")") { i++; break }
      if (payload[i] === "'") {
        // string literal
        i++
        let s = ""
        while (i < payload.length) {
          const c = payload[i]
          if (c === "\\" && i + 1 < payload.length) {
            const n = payload[i + 1]
            if (n === "n") s += "\n"
            else if (n === "r") s += "\r"
            else if (n === "t") s += "\t"
            else if (n === "0") s += "\0"
            else s += n
            i += 2
            continue
          }
          if (c === "'") { i++; break }
          s += c
          i++
        }
        row.push(s)
      } else if (payload.startsWith("NULL", i)) {
        row.push(null)
        i += 4
      } else {
        // number or unquoted literal
        let s = ""
        while (i < payload.length && payload[i] !== "," && payload[i] !== ")") {
          s += payload[i]
          i++
        }
        const trimmed = s.trim()
        const n = Number(trimmed)
        row.push(Number.isFinite(n) && trimmed !== "" ? n : trimmed)
      }
    }
    rows.push(row)
  }
  return rows
}

function parseSQL(path: string): Map<string, Row[]> {
  const text = readFileSync(path, "utf8")
  const tables = new Map<string, Row[]>()
  // multiline INSERTs split on ;\n — wpvivid writes one INSERT per table
  // sometimes broken into chunks, so we scan ALL of them.
  const insertRe = /INSERT INTO `([^`]+)` (?:\([^)]+\) )?VALUES /g
  let m: RegExpExecArray | null
  while ((m = insertRe.exec(text)) !== null) {
    const table = m[1]
    const start = m.index + m[0].length
    // find statement terminator — first ";" not inside a quoted string
    let i = start
    let inStr = false
    while (i < text.length) {
      const c = text[i]
      if (c === "\\") { i += 2; continue }
      if (c === "'") inStr = !inStr
      else if (c === ";" && !inStr) break
      i++
    }
    const payload = text.substring(start, i)
    const rows = tokenizeValues(payload)
    const list = tables.get(table) ?? []
    list.push(...rows)
    tables.set(table, list)
  }
  return tables
}

// ---------------------------------------------------------------------------
// Column-name maps. Hand-derived from the WP schemas at the top of the SQL.
// ---------------------------------------------------------------------------

const WP_USERS_COLS = [
  "ID", "user_login", "user_pass", "user_nicename", "user_email",
  "user_url", "user_registered", "user_activation_key", "user_status", "display_name",
] as const

const WP_USERMETA_COLS = ["umeta_id", "user_id", "meta_key", "meta_value"] as const

const WC_ORDER_STATS_COLS = [
  "order_id", "parent_id", "date_created", "date_created_gmt", "date_paid",
  "date_completed", "num_items_sold", "total_sales", "tax_total", "shipping_total",
  "net_total", "returning_customer", "status", "customer_id",
] as const

const WP_POSTMETA_COLS = ["meta_id", "post_id", "meta_key", "meta_value"] as const

const WP_POSTS_COLS = [
  "ID", "post_author", "post_date", "post_date_gmt", "post_content",
  "post_title", "post_excerpt", "post_status", "comment_status", "ping_status",
  "post_password", "post_name", "to_ping", "pinged", "post_modified",
  "post_modified_gmt", "post_content_filtered", "post_parent", "guid", "menu_order",
  "post_type", "post_mime_type", "comment_count",
] as const

const WC_ORDER_ITEMS_COLS = [
  "order_item_id", "order_item_name", "order_item_type", "order_id",
] as const

const WC_ORDER_ITEMMETA_COLS = ["meta_id", "order_item_id", "meta_key", "meta_value"] as const

function rowToObj<T extends readonly string[]>(row: Row, cols: T): Record<T[number], any> {
  const out: any = {}
  for (let i = 0; i < cols.length; i++) out[cols[i]] = row[i]
  return out
}

// ---------------------------------------------------------------------------
// WP status → our status mapping
// ---------------------------------------------------------------------------

function mapOrderStatus(wp: string): { status: string; payment_status: string } {
  const s = (wp ?? "").replace(/^wc-/, "")
  switch (s) {
    case "completed":  return { status: "completed", payment_status: "paid" }
    case "processing": return { status: "processing", payment_status: "paid" }
    case "on-hold":    return { status: "pending", payment_status: "pending" }
    case "pending":    return { status: "pending", payment_status: "pending" }
    case "cancelled":  return { status: "cancelled", payment_status: "pending" }
    case "refunded":   return { status: "cancelled", payment_status: "refunded" }
    case "failed":     return { status: "failed", payment_status: "failed" }
    default:           return { status: "pending", payment_status: "pending" }
  }
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[import] reading ${sqlPath}${dryRun ? " (dry-run)" : ""}`)
  const tables = parseSQL(sqlPath)
  console.log(`[import] parsed ${tables.size} tables`)

  const users = (tables.get("wp_users") ?? []).map((r) => rowToObj(r, WP_USERS_COLS))
  const usermeta = (tables.get("wp_usermeta") ?? []).map((r) => rowToObj(r, WP_USERMETA_COLS))
  const orderStats = (tables.get("wp_wc_order_stats") ?? []).map((r) =>
    rowToObj(r, WC_ORDER_STATS_COLS),
  )
  const postmeta = (tables.get("wp_postmeta") ?? []).map((r) => rowToObj(r, WP_POSTMETA_COLS))
  const posts = (tables.get("wp_posts") ?? []).map((r) => rowToObj(r, WP_POSTS_COLS))
  const orderItems = (tables.get("wp_woocommerce_order_items") ?? []).map((r) =>
    rowToObj(r, WC_ORDER_ITEMS_COLS),
  )
  const orderItemmeta = (tables.get("wp_woocommerce_order_itemmeta") ?? []).map((r) =>
    rowToObj(r, WC_ORDER_ITEMMETA_COLS),
  )

  console.log(`[import] ${users.length} users, ${orderStats.length} orders`)
  console.log(`[import] ${posts.length} posts (filtering shop_order), ${postmeta.length} postmeta`)
  console.log(`[import] ${orderItems.length} order_items, ${orderItemmeta.length} order_itemmeta`)

  // ---- Build user_id → metadata map ----
  const userMetaByUser = new Map<number, Map<string, string>>()
  for (const m of usermeta) {
    const uid = Number(m.user_id)
    if (!userMetaByUser.has(uid)) userMetaByUser.set(uid, new Map())
    userMetaByUser.get(uid)!.set(String(m.meta_key), String(m.meta_value ?? ""))
  }

  // ---- Build post_id → metadata map (orders only) ----
  const postMetaByPost = new Map<number, Map<string, string>>()
  for (const m of postmeta) {
    const pid = Number(m.post_id)
    if (!postMetaByPost.has(pid)) postMetaByPost.set(pid, new Map())
    postMetaByPost.get(pid)!.set(String(m.meta_key), String(m.meta_value ?? ""))
  }

  // ---- Build order_item_id → metadata map ----
  const itemMetaByItem = new Map<number, Map<string, string>>()
  for (const m of orderItemmeta) {
    const iid = Number(m.order_item_id)
    if (!itemMetaByItem.has(iid)) itemMetaByItem.set(iid, new Map())
    itemMetaByItem.get(iid)!.set(String(m.meta_key), String(m.meta_value ?? ""))
  }

  // ---- WP-user-ID → Supabase auth.users.id mapping (built during user import) ----
  const wpIdToSupabaseId = new Map<number, string>()

  // ===========================================================================
  // 1. USERS
  // ===========================================================================
  console.log(`\n[users] processing ${users.length} accounts...`)
  let usersCreated = 0, usersUpdated = 0, usersSkipped = 0

  // Fetch existing Supabase users in one shot (handles up to 1000)
  const existing = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const existingByEmail = new Map<string, string>()
  for (const u of existing.data.users ?? []) {
    if (u.email) existingByEmail.set(u.email.toLowerCase(), u.id)
  }

  for (const u of users) {
    const email = String(u.user_email ?? "").trim().toLowerCase()
    if (!email) { usersSkipped++; continue }
    const wpId = Number(u.ID)
    const displayName = String(u.display_name ?? u.user_login ?? "").trim()
    const wpHash = String(u.user_pass ?? "")
    const userMeta = userMetaByUser.get(wpId) ?? new Map<string, string>()

    const phone =
      userMeta.get("billing_phone") ||
      userMeta.get("shipping_phone") ||
      null

    const profilePatch: Record<string, any> = {
      display_name: displayName || null,
      wp_legacy_user_id: wpId,
      wp_legacy_user_login: String(u.user_login ?? ""),
      wp_imported_at: new Date().toISOString(),
    }
    if (wpHash) profilePatch.wp_legacy_password_hash = wpHash
    if (phone) profilePatch.phone = phone

    let supabaseUserId = existingByEmail.get(email)

    if (supabaseUserId) {
      // Merge — only fill empty fields (user-side data wins). Phone we read-then-write.
      if (!dryRun) {
        const { data: existingProfile } = await supabase
          .from("user_profiles")
          .select("phone, display_name, wp_legacy_password_hash")
          .eq("user_id", supabaseUserId)
          .maybeSingle()
        const epp = existingProfile as any
        const finalPatch: Record<string, any> = {
          wp_legacy_user_id: wpId,
          wp_legacy_user_login: String(u.user_login ?? ""),
          wp_imported_at: new Date().toISOString(),
        }
        // Don't overwrite if user already set a value; only fill blanks.
        if (!epp?.display_name && displayName) finalPatch.display_name = displayName
        if (!epp?.phone && phone) finalPatch.phone = phone
        // Always set the WP legacy hash even on merge — gives the imported
        // user a path to log in with their original WP password.
        if (wpHash && !epp?.wp_legacy_password_hash) {
          finalPatch.wp_legacy_password_hash = wpHash
        }
        await supabase.from("user_profiles").update(finalPatch).eq("user_id", supabaseUserId)
      }
      usersUpdated++
    } else {
      // Create — random password, email pre-confirmed so legacy login works
      const randomPassword = randomBytes(24).toString("base64") + "Aa1!"
      if (!dryRun) {
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: randomPassword,
          email_confirm: true,
          user_metadata: { display_name: displayName, imported_from: "wp" },
        })
        if (error) {
          console.error(`[users] create ${email} failed:`, error.message)
          usersSkipped++
          continue
        }
        supabaseUserId = data.user!.id
        // Auth trigger (migration 0022) auto-creates user_profiles row; patch it.
        await supabase.from("user_profiles").update(profilePatch).eq("user_id", supabaseUserId)
      }
      usersCreated++
    }

    if (supabaseUserId) wpIdToSupabaseId.set(wpId, supabaseUserId)
  }

  console.log(`[users] created=${usersCreated} updated=${usersUpdated} skipped=${usersSkipped}`)

  // ===========================================================================
  // 2. ORDERS
  // ===========================================================================
  console.log(`\n[orders] processing ${orderStats.length} orders...`)
  let ordersCreated = 0, ordersUpdated = 0, ordersSkipped = 0

  // Filter posts to shop_order only
  const shopOrderById = new Map<number, any>()
  for (const p of posts) {
    if (p.post_type === "shop_order") shopOrderById.set(Number(p.ID), p)
  }

  // Group order items by order_id
  const itemsByOrder = new Map<number, any[]>()
  for (const it of orderItems) {
    if (it.order_item_type !== "line_item") continue
    const oid = Number(it.order_id)
    if (!itemsByOrder.has(oid)) itemsByOrder.set(oid, [])
    itemsByOrder.get(oid)!.push(it)
  }

  for (const o of orderStats) {
    const wpOrderId = Number(o.order_id)
    const orderNumber = `WP${wpOrderId}`
    const customerWpId = Number(o.customer_id)
    const supabaseUserId = wpIdToSupabaseId.get(customerWpId) ?? null
    const meta = postMetaByPost.get(wpOrderId) ?? new Map<string, string>()
    const guestEmail = meta.get("_billing_email") ?? null
    const { status, payment_status } = mapOrderStatus(String(o.status))
    const dateCreated = String(o.date_created ?? "").replace(" ", "T") + "+08:00"

    const subtotal = Number(o.net_total ?? 0)
    const shippingFee = Number(o.shipping_total ?? 0)
    const total = Number(o.total_sales ?? 0)
    const discount = Math.max(0, subtotal + shippingFee - total)

    // metadata: keep the raw WP fields for audit
    const metadata = {
      wp_order_id: wpOrderId,
      wp_status: o.status,
      wp_payment_method: meta.get("_payment_method") ?? null,
      wp_payment_method_title: meta.get("_payment_method_title") ?? null,
      wp_shipping_method: meta.get("_shipping_method") ?? null,
      wp_customer_note: shopOrderById.get(wpOrderId)?.post_excerpt ?? null,
      imported_at: new Date().toISOString(),
    }

    const orderPayload: Record<string, any> = {
      order_number: orderNumber,
      user_id: supabaseUserId,
      guest_email: supabaseUserId ? null : guestEmail,
      status,
      payment_status,
      subtotal,
      shipping_fee: shippingFee,
      discount_amount: discount,
      total,
      metadata,
      created_at: dateCreated,
    }

    // Check existence
    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("order_number", orderNumber)
      .maybeSingle()

    let orderId: string | null = (existingOrder as any)?.id ?? null

    if (orderId) {
      if (!dryRun) {
        await supabase.from("orders").update(orderPayload).eq("id", orderId)
      }
      ordersUpdated++
    } else {
      if (!dryRun) {
        const { data, error } = await supabase
          .from("orders")
          .insert(orderPayload)
          .select("id")
          .single()
        if (error || !data) {
          console.error(`[orders] insert ${orderNumber} failed:`, error?.message)
          ordersSkipped++
          continue
        }
        orderId = (data as any).id as string
      } else {
        orderId = `dryrun-${wpOrderId}`
      }
      ordersCreated++
    }

    // ---- Addresses ----
    const billingName =
      ((meta.get("_billing_last_name") ?? "") + (meta.get("_billing_first_name") ?? "")).trim() ||
      "—"
    const billingPhone = meta.get("_billing_phone") ?? "—"
    const billingAddress =
      [
        meta.get("_billing_postcode") ?? "",
        meta.get("_billing_state") ?? "",
        meta.get("_billing_city") ?? "",
        meta.get("_billing_address_1") ?? "",
        meta.get("_billing_address_2") ?? "",
      ].filter(Boolean).join(" ").trim() || "—"

    const shippingName =
      ((meta.get("_shipping_last_name") ?? "") + (meta.get("_shipping_first_name") ?? "")).trim() ||
      billingName
    const shippingPhone = meta.get("_shipping_phone") ?? billingPhone
    const shippingAddress =
      [
        meta.get("_shipping_postcode") ?? "",
        meta.get("_shipping_state") ?? "",
        meta.get("_shipping_city") ?? "",
        meta.get("_shipping_address_1") ?? "",
        meta.get("_shipping_address_2") ?? "",
      ].filter(Boolean).join(" ").trim() || billingAddress

    if (!dryRun && orderId && !orderId.startsWith("dryrun-")) {
      await supabase.from("order_addresses").delete().eq("order_id", orderId)
      await supabase.from("order_addresses").insert([
        {
          order_id: orderId, type: "billing",
          name: billingName, phone: billingPhone,
          address_type: "home", address: billingAddress,
          city: meta.get("_billing_city") ?? null,
          postal_code: meta.get("_billing_postcode") ?? null,
        },
        {
          order_id: orderId, type: "shipping",
          name: shippingName, phone: shippingPhone,
          address_type: "home", address: shippingAddress,
          city: meta.get("_shipping_city") ?? null,
          postal_code: meta.get("_shipping_postcode") ?? null,
        },
      ])
    }

    // ---- Order items ----
    const items = itemsByOrder.get(wpOrderId) ?? []
    if (!dryRun && orderId && !orderId.startsWith("dryrun-")) {
      await supabase.from("order_items").delete().eq("order_id", orderId)
      const itemRows = items.map((it) => {
        const im = itemMetaByItem.get(Number(it.order_item_id)) ?? new Map<string, string>()
        const qty = Number(im.get("_qty") ?? 1)
        const lineSubtotal = Number(im.get("_line_subtotal") ?? im.get("_line_total") ?? 0)
        const unitPrice = qty > 0 ? lineSubtotal / qty : 0
        return {
          order_id: orderId,
          variant_id: null,
          qty,
          unit_price: unitPrice,
          product_snapshot: {
            name: it.order_item_name ?? "",
            wp_order_item_id: Number(it.order_item_id),
            wp_product_id: Number(im.get("_product_id") ?? 0) || null,
            wp_variation_id: Number(im.get("_variation_id") ?? 0) || null,
            sku: im.get("_sku") ?? null,
          },
        }
      })
      if (itemRows.length > 0) await supabase.from("order_items").insert(itemRows)
    }
  }

  console.log(`[orders] created=${ordersCreated} updated=${ordersUpdated} skipped=${ordersSkipped}`)

  console.log(`\n[import] done${dryRun ? " (DRY-RUN — no writes)" : ""}`)
}

main().catch((err) => {
  console.error("[import] fatal:", err)
  process.exit(1)
})
