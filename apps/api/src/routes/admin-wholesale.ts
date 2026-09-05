import { Router } from "express"
import { z } from "zod"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"

/**
 * 通路商批發訂單 — 後台端點。
 *
 * 設計：docs/superpowers/specs/2026-08-26-wholesale-channel-portal-design.md
 * 資料結構：packages/db/migrations/0052_wholesale_channels.sql
 *
 * 第一階段只做後台。五家通路商目前都用 LINE／電話下單、由創辦人手動輸入系統；
 * 先讓這件事在系統裡做完（不必二次輸入、通路數字與零售分開、對帳不用翻聊天
 * 紀錄）。通路商自助下單留到第二階段 —— 只有五家，先確定他們真的會用網站再做。
 */
export const adminWholesaleRouter = Router()
adminWholesaleRouter.use(requireAuth, requireAdmin)

/**
 * 批發訂單的狀態沿用零售那組值，不新增 enum：
 *   pending 待確認 → processing 已確認 → shipped 已出貨 → completed 已完成
 * 這樣不必動 orders.status 的 check constraint，既有的取消流程也照樣適用。
 * 收款與出貨是兩條獨立的線，收款走 wholesale_paid_at，不擠進 payment_status。
 */
export const WHOLESALE_STATUS_LABEL: Record<string, string> = {
  pending: "待確認",
  processing: "已確認",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
}

/** 宅配 150 元/箱、訂單金額滿 4,000 免運（兩份報價單的備註都是這個條件）。 */
export const SHIPPING_FEE_PER_BOX = 150
export const FREE_SHIPPING_THRESHOLD = 4000

type PriceRow = { variant_id: string; list_price: number; wholesale_price: number }
type ItemRow = {
  channel_id: string
  variant_id: string
  wholesale_price: number | null
  is_available: boolean
}

/**
 * 一家通路商的完整品項清單 = 標準價套上這家的差異。
 *
 * 連「沒有差異」的品項也一起回傳，因為後台要顯示整份價目表供人覆寫。判斷一列
 * 有沒有例外要看 isOverridden，不能拿「價格是否等於標準價」去比 —— 那會把
 * 「刻意談到跟標準價相同」誤判成沒有例外，日後全面調價時它會跟著被改掉。
 */
export async function channelPriceList(channelId: string) {
  const [{ data: prices }, { data: items }, { data: variants }, { data: products }] =
    await Promise.all([
      supabase.from("wholesale_prices").select("variant_id, list_price, wholesale_price"),
      supabase
        .from("wholesale_channel_items")
        .select("channel_id, variant_id, wholesale_price, is_available")
        .eq("channel_id", channelId),
      supabase.from("product_variants").select("id, name, product_id, stock_qty"),
      supabase.from("products").select("id, name"),
    ])

  const productName = new Map((products ?? []).map((p) => [p.id as string, p.name as string]))
  const variantMeta = new Map(
    (variants ?? []).map((v) => [
      v.id as string,
      {
        productName: productName.get(v.product_id as string) ?? "",
        variantName: v.name as string,
        stockQty: Number(v.stock_qty ?? 0),
      },
    ]),
  )
  return mergeChannelPrices((prices ?? []) as PriceRow[], (items ?? []) as ItemRow[], variantMeta)
}

export type VariantMeta = { productName: string; variantName: string; stockQty: number }
export type ChannelPriceRow = {
  variantId: string
  productName: string
  variantName: string
  stockQty: number
  listPrice: number
  standardPrice: number
  price: number
  isAvailable: boolean
  isOverridden: boolean
}

/**
 * 標準價 × 這家的差異 → 這家的實際價目表。純函式，方便單獨測試 —— 這段算的是
 * 開給客戶的價格，錯了就是開錯帳單。
 */
export function mergeChannelPrices(
  prices: PriceRow[],
  items: ItemRow[],
  variantMeta: Map<string, VariantMeta>,
): ChannelPriceRow[] {
  const byVariant = new Map(items.map((i) => [i.variant_id, i]))

  return prices
    .map((p) => {
      const ov = byVariant.get(p.variant_id)
      const meta = variantMeta.get(p.variant_id)
      return {
        variantId: p.variant_id,
        productName: meta?.productName ?? "(已刪除的商品)",
        variantName: meta?.variantName ?? "",
        stockQty: meta?.stockQty ?? 0,
        listPrice: p.list_price,
        standardPrice: p.wholesale_price,
        // 實際成交價：有例外用例外價，沒有就用標準價。注意 ?? 而不是 ||，
        // 因為一列可能只是「不供貨」而 wholesale_price 是 null —— 那種列的價格
        // 要落回標準價，不是 0。
        price: ov?.wholesale_price ?? p.wholesale_price,
        isAvailable: ov ? ov.is_available : true,
        isOverridden: Boolean(ov),
      }
    })
    .sort((a, b) => a.productName.localeCompare(b.productName, "zh-Hant"))
}

/**
 * 批發訂單金額。宅配 150 元/箱，訂單金額滿 4,000 免運。
 * 門檻比的是商品小計，不含運費本身 —— 否則運費會把訂單推過門檻再把自己消掉。
 */
export function calcWholesaleTotals(
  lines: Array<{ unitPrice: number; qty: number }>,
  boxes: number,
): { subtotal: number; shippingFee: number; total: number } {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const shippingFee =
    subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : Math.max(0, boxes) * SHIPPING_FEE_PER_BOX
  return { subtotal, shippingFee, total: subtotal + shippingFee }
}

// ---------------------------------------------------------------------------
// 通路商
// ---------------------------------------------------------------------------

adminWholesaleRouter.get("/channels", async (_req, res) => {
  const { data, error } = await supabase
    .from("wholesale_channels")
    .select("*")
    .order("created_at", { ascending: true })
  if (error) { res.status(500).json({ error: error.message }); return }

  const { data: items } = await supabase
    .from("wholesale_channel_items")
    .select("channel_id, is_available")
  const counts = new Map<string, { overrides: number; unavailable: number }>()
  for (const i of (items ?? []) as Array<{ channel_id: string; is_available: boolean }>) {
    const c = counts.get(i.channel_id) ?? { overrides: 0, unavailable: 0 }
    c.overrides += 1
    if (!i.is_available) c.unavailable += 1
    counts.set(i.channel_id, c)
  }

  res.json({
    channels: (data ?? []).map((c) => ({
      ...c,
      overrideCount: counts.get(c.id as string)?.overrides ?? 0,
      unavailableCount: counts.get(c.id as string)?.unavailable ?? 0,
    })),
  })
})

adminWholesaleRouter.get("/channels/:id", async (req, res) => {
  const { data: channel, error } = await supabase
    .from("wholesale_channels")
    .select("*")
    .eq("id", req.params.id)
    .single()
  if (error || !channel) { res.status(404).json({ error: "找不到這家通路商" }); return }
  res.json({ channel, items: await channelPriceList(req.params.id) })
})

const channelPatchSchema = z.object({
  name: z.string().min(1).optional(),
  contact_name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  tax_id: z.string().nullable().optional(),
  payment_terms: z.enum(["on_receipt_3d", "month_end"]).optional(),
  msrp_floor_sachet: z.number().int().nullable().optional(),
  msrp_floor_pouch: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
})

adminWholesaleRouter.patch("/channels/:id", async (req, res) => {
  const parsed = channelPatchSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: "欄位格式不正確" }); return }
  const { data, error } = await supabase
    .from("wholesale_channels")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ channel: data })
})

// ---------------------------------------------------------------------------
// 個別差異（例外價 / 不供貨）
// ---------------------------------------------------------------------------

const itemPutSchema = z.object({
  wholesalePrice: z.number().int().positive().nullable(),
  isAvailable: z.boolean(),
})

adminWholesaleRouter.put("/channels/:id/items/:variantId", async (req, res) => {
  const parsed = itemPutSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: "欄位格式不正確" }); return }
  const { wholesalePrice, isAvailable } = parsed.data

  // 沒改價、又照常供貨 = 這一列沒有差異，直接刪掉回到標準價。
  //
  // 這正是「恢復標準價」這個動作存在的意義：如果把「與標準相同」也存成一列，
  // 它跟「剛好填了同一個數字」在資料上就分不出來，日後調整標準價時，後者不會
  // 跟著變 —— 而畫面上完全看不出差別。資料庫的 check constraint 也擋著這種列。
  if (wholesalePrice === null && isAvailable) {
    const { error } = await supabase
      .from("wholesale_channel_items")
      .delete()
      .eq("channel_id", req.params.id)
      .eq("variant_id", req.params.variantId)
    if (error) { res.status(500).json({ error: error.message }); return }
    res.json({ ok: true, restoredToStandard: true })
    return
  }

  const { error } = await supabase.from("wholesale_channel_items").upsert({
    channel_id: req.params.id,
    variant_id: req.params.variantId,
    wholesale_price: wholesalePrice,
    is_available: isAvailable,
    updated_at: new Date().toISOString(),
  })
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ ok: true, restoredToStandard: false })
})

// ---------------------------------------------------------------------------
// 標準批發價
// ---------------------------------------------------------------------------

adminWholesaleRouter.get("/prices", async (_req, res) => {
  const [{ data: prices }, { data: variants }, { data: products }] = await Promise.all([
    supabase.from("wholesale_prices").select("*"),
    supabase.from("product_variants").select("id, name, product_id"),
    supabase.from("products").select("id, name"),
  ])
  const productName = new Map((products ?? []).map((p) => [p.id as string, p.name as string]))
  const meta = new Map(
    (variants ?? []).map((v) => [v.id as string, productName.get(v.product_id as string) ?? ""]),
  )
  res.json({
    prices: ((prices ?? []) as PriceRow[])
      .map((p) => ({ ...p, product_name: meta.get(p.variant_id) ?? "(已刪除的商品)" }))
      .sort((a, b) => a.product_name.localeCompare(b.product_name, "zh-Hant")),
  })
})

adminWholesaleRouter.patch("/prices/:variantId", async (req, res) => {
  const parsed = z
    .object({
      list_price: z.number().int().positive().optional(),
      wholesale_price: z.number().int().positive().optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: "欄位格式不正確" }); return }
  const { data, error } = await supabase
    .from("wholesale_prices")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("variant_id", req.params.variantId)
    .select()
    .single()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ price: data })
})

// ---------------------------------------------------------------------------
// 批發訂單
// ---------------------------------------------------------------------------

const createOrderSchema = z.object({
  channelId: z.string().uuid(),
  items: z
    .array(z.object({ variantId: z.string().uuid(), qty: z.number().int().positive() }))
    .min(1),
  /** 幾箱；運費 = 箱數 × 150，訂單金額滿 4,000 免運。 */
  boxes: z.number().int().min(0).default(1),
  notes: z.string().nullable().optional(),
})

/**
 * POST /admin/wholesale/orders — 代通路商建單。
 *
 * 價格一律由伺服器依 channelPriceList 重算，不接受前端傳來的單價 —— 跟零售
 * 結帳同一個原則。前端只說「哪一家、哪些品項、各幾件」。
 */
adminWholesaleRouter.post("/orders", async (req, res) => {
  const parsed = createOrderSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: "欄位格式不正確" }); return }
  const { channelId, items, boxes, notes } = parsed.data

  const { data: channel } = await supabase
    .from("wholesale_channels")
    .select("id, name, payment_terms, is_active")
    .eq("id", channelId)
    .single()
  if (!channel) { res.status(404).json({ error: "找不到這家通路商" }); return }
  if (channel.is_active === false) {
    res.status(400).json({ error: "這家通路商已停用" }); return
  }

  // 同一個品項若被送成兩列，先合併再算 —— 否則庫存會被扣兩次、也繞過供貨檢查。
  const merged = new Map<string, number>()
  for (const i of items) merged.set(i.variantId, (merged.get(i.variantId) ?? 0) + i.qty)

  const priceList = await channelPriceList(channelId)
  const byVariant = new Map(priceList.map((p) => [p.variantId, p]))

  const lines: Array<{ variantId: string; qty: number; unitPrice: number; name: string }> = []
  for (const [variantId, qty] of merged) {
    const p = byVariant.get(variantId)
    if (!p) {
      res.status(400).json({ error: `品項不在批發價目表中：${variantId}` }); return
    }
    if (!p.isAvailable) {
      res.status(400).json({ error: `${channel.name} 不供應「${p.productName}」` }); return
    }
    lines.push({ variantId, qty, unitPrice: p.price, name: p.productName })
  }

  const { subtotal, shippingFee, total } = calcWholesaleTotals(lines, boxes)

  const { data: seqResult, error: seqErr } = await supabase.rpc("next_order_number")
  if (seqErr || !seqResult) {
    console.error("[admin/wholesale] next_order_number failed:", seqErr)
    res.status(500).json({ error: "無法產生訂單編號" }); return
  }

  // 批發訂單是真的出貨，庫存照扣，跟零售用同一支原子 RPC。
  const variantsPayload = lines.map((l) => ({ id: l.variantId, qty: l.qty }))
  const stockResp = await supabase.rpc("atomic_deduct_stock", { p_variants: variantsPayload })
  if (stockResp.error) {
    res.status(409).json({ error: "商品庫存不足" }); return
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_number: String(seqResult),
      order_type: "wholesale",
      wholesale_channel_id: channelId,
      status: "pending",
      // 月結：出貨時附帳單，收貨後 3 個工作天或月底付款。付款與否看
      // wholesale_paid_at，payment_status 只是讓既有查詢不至於看到 null。
      payment_status: "pending",
      shipping_method: "home_delivery",
      // 批發沒有線上金流，payment_method 就是 null。不硬塞一個 'wholesale_terms'：
      // orders.payment_method 有 check constraint，塞進去整筆 insert 會被擋掉
      // （23514），而「這筆訂單沒有線上付款方式」本來就是 null 要表達的意思。
      payment_method: null,
      subtotal,
      shipping_fee: shippingFee,
      discount_amount: 0,
      total,
      notes: notes ?? null,
    })
    .select("id, order_number")
    .single()

  if (orderError || !order) {
    console.error("[admin/wholesale] insert order failed:", orderError)
    await supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload })
    res.status(500).json({ error: "建立訂單失敗" }); return
  }

  const { error: itemsError } = await supabase.from("order_items").insert(
    lines.map((l) => ({
      order_id: order.id,
      variant_id: l.variantId,
      qty: l.qty,
      unit_price: l.unitPrice,
      // 成交當下的品名與單價寫進快照：日後調整批發價，歷史訂單與對帳金額不會被改寫。
      product_snapshot: { name: l.name, variant_name: "預設", wholesale: true },
    })),
  )
  if (itemsError) {
    console.error("[admin/wholesale] insert order_items failed:", itemsError)
    await Promise.all([
      supabase.rpc("atomic_restore_stock", { p_variants: variantsPayload }),
      supabase.from("orders").delete().eq("id", order.id),
    ])
    res.status(500).json({ error: "建立訂單明細失敗" }); return
  }

  res.status(201).json({
    order: { id: order.id, orderNumber: order.order_number, subtotal, shippingFee, total },
  })
})

adminWholesaleRouter.get("/orders", async (req, res) => {
  const { channelId, from, to } = req.query as Record<string, string | undefined>
  let q = supabase
    .from("orders")
    .select("id, order_number, status, subtotal, shipping_fee, total, notes, created_at, wholesale_channel_id, wholesale_due_date, wholesale_paid_at")
    .eq("order_type", "wholesale")
    .order("created_at", { ascending: false })
  if (channelId) q = q.eq("wholesale_channel_id", channelId)
  if (from) q = q.gte("created_at", from)
  if (to) q = q.lte("created_at", to)

  const { data, error } = await q
  if (error) { res.status(500).json({ error: error.message }); return }

  const { data: channels } = await supabase.from("wholesale_channels").select("id, name")
  const name = new Map((channels ?? []).map((c) => [c.id as string, c.name as string]))

  res.json({
    orders: (data ?? []).map((o) => ({
      ...o,
      channel_name: name.get(o.wholesale_channel_id as string) ?? "—",
      status_label: WHOLESALE_STATUS_LABEL[o.status as string] ?? o.status,
    })),
  })
})

/**
 * 付款到期日。
 *   on_receipt_3d 收貨後 3 個工作天 —— 從出貨日起算，跳過六日
 *   month_end     當月最後一天
 * 以台北時間計算：出貨都在台灣，用 UTC 會在半夜前後差一天。
 */
export function calcDueDate(
  shippedAt: Date,
  terms: "on_receipt_3d" | "month_end",
): string {
  const tpe = new Date(shippedAt.getTime() + 8 * 3600 * 1000)
  if (terms === "month_end") {
    const end = new Date(Date.UTC(tpe.getUTCFullYear(), tpe.getUTCMonth() + 1, 0))
    return end.toISOString().slice(0, 10)
  }
  const d = new Date(Date.UTC(tpe.getUTCFullYear(), tpe.getUTCMonth(), tpe.getUTCDate()))
  let added = 0
  while (added < 3) {
    d.setUTCDate(d.getUTCDate() + 1)
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) added += 1
  }
  return d.toISOString().slice(0, 10)
}

adminWholesaleRouter.get("/orders/:id", async (req, res) => {
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", req.params.id)
    .eq("order_type", "wholesale")
    .single()
  if (error || !order) { res.status(404).json({ error: "找不到這張批發訂單" }); return }

  const [{ data: channel }, { data: items }] = await Promise.all([
    supabase
      .from("wholesale_channels")
      .select("*")
      .eq("id", order.wholesale_channel_id as string)
      .maybeSingle(),
    supabase
      .from("order_items")
      .select("id, variant_id, qty, unit_price, product_snapshot")
      .eq("order_id", order.id as string),
  ])

  res.json({
    order: { ...order, status_label: WHOLESALE_STATUS_LABEL[order.status as string] ?? order.status },
    channel,
    items: (items ?? []).map((i) => {
      const snap = (i.product_snapshot ?? {}) as { name?: string }
      return {
        id: i.id,
        name: snap.name ?? "商品",
        qty: Number(i.qty),
        unitPrice: Number(i.unit_price),
        amount: Number(i.qty) * Number(i.unit_price),
      }
    }),
  })
})

const orderPatchSchema = z.object({
  status: z.enum(["pending", "processing", "shipped", "completed", "cancelled"]).optional(),
  markPaid: z.boolean().optional(),
})

/**
 * PATCH /admin/wholesale/orders/:id — 推進狀態 / 標記收款。
 *
 * 出貨與收款是兩條獨立的線：出貨改 status，收款寫 wholesale_paid_at。標記出貨時
 * 順手依這家的付款條件算出到期日，因為那正是「出貨時附帳單」的那張帳單要印的
 * 日期 —— 事後補算就得回頭查出貨日，容易算錯。
 */
adminWholesaleRouter.patch("/orders/:id", async (req, res) => {
  const parsed = orderPatchSchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: "欄位格式不正確" }); return }
  const { status, markPaid } = parsed.data

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, wholesale_channel_id, wholesale_due_date")
    .eq("id", req.params.id)
    .eq("order_type", "wholesale")
    .single()
  if (!order) { res.status(404).json({ error: "找不到這張批發訂單" }); return }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (status) patch.status = status

  // 第一次標記出貨時才算到期日；重複出貨或事後改狀態不覆寫已經印在帳單上的日期。
  if (status === "shipped" && !order.wholesale_due_date) {
    const { data: channel } = await supabase
      .from("wholesale_channels")
      .select("payment_terms")
      .eq("id", order.wholesale_channel_id as string)
      .maybeSingle()
    const terms = (channel?.payment_terms as "on_receipt_3d" | "month_end") ?? "on_receipt_3d"
    patch.wholesale_due_date = calcDueDate(new Date(), terms)
  }

  if (markPaid === true) {
    patch.wholesale_paid_at = new Date().toISOString()
    patch.payment_status = "paid"
  } else if (markPaid === false) {
    patch.wholesale_paid_at = null
    patch.payment_status = "pending"
  }

  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", req.params.id)
    .select()
    .single()
  if (error) { res.status(500).json({ error: error.message }); return }
  res.json({ order: data })
})
