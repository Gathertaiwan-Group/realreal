import { supabase } from "../lib/supabase"
import { createCvsLogistics, createHomeDelivery } from "../lib/ecpay-logistics"
import { getSetting, SETTING_DEFAULTS } from "../lib/settings"

/**
 * Create the ECPay logistics record for a paid order.
 *
 * Table = `logistics` (NOT `logistics_records` — old worker referenced a
 * non-existent table and inserts silently failed).
 * Column map per packages/db/migrations/0001_initial.sql:
 *   - ecpay_logistics_id (not logistics_id)
 *   - type (not shipping_method) — one of CVS / HOME
 *   - provider defaults to 'ecpay'
 *   - status starts at 'pending', webhook updates it later
 */
export async function processCreateShipment(orderId: string) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, shipping_method, status, payment_status, total")
    .eq("id", orderId)
    .single()

  if (!order) throw new Error(`Order ${orderId} not found`)
  if (order.payment_status !== "paid") {
    console.log(`[logistics-creator] order ${orderId} payment_status="${order.payment_status}", skipping`)
    return
  }

  // 手動出貨模式：跳過綠界物流，記錄為 manual，由 admin 自行出貨
  const skipEcpay = ((await getSetting("logistics.skip_ecpay")) ?? SETTING_DEFAULTS["logistics.skip_ecpay"]) === "true"
  if (skipEcpay) {
    const { data: existing } = await supabase.from("logistics").select("id").eq("order_id", orderId).limit(1).maybeSingle()
    if (!existing) {
      await supabase.from("logistics").insert({ order_id: orderId, provider: "manual", type: "HOME", status: "pending" })
    }
    console.log(`[logistics-creator] skip_ecpay=true — order ${orderId} recorded as manual shipment`)
    return
  }

  // 海外到付：無 ECPay 物流，admin 手動安排
  if (order.shipping_method === "overseas_cod") {
    console.log(`[logistics-creator] overseas_cod order ${orderId}, skipping ECPay logistics`)
    return
  }

  // Idempotency: skip if a logistics row already exists for this order.
  const { data: existing } = await supabase
    .from("logistics")
    .select("id")
    .eq("order_id", orderId)
    .limit(1)
    .maybeSingle()

  if (existing) {
    console.log(`[logistics-creator] logistics record already exists for order ${orderId}, skipping`)
    return
  }

  const { data: address } = await supabase
    .from("order_addresses")
    .select("name, phone, email, address, postal_code, city, cvs_store_id, cvs_type")
    .eq("order_id", orderId)
    .eq("type", "shipping")
    .maybeSingle()

  if (!address) throw new Error(`Shipping address not found for order ${orderId}`)

  const goodsAmount = Math.round(Number(order.total ?? 0))

  let ecpayLogisticsId: string
  let cvsPaymentNo: string | null = null
  let cvsValidationNo: string | null = null
  let logisticsType: "CVS" | "HOME"

  if (order.shipping_method === "home_delivery") {
    logisticsType = "HOME"
    const result = await createHomeDelivery(
      orderId,
      address.name,
      address.phone,
      address.postal_code ?? "",
      address.city ?? "",
      address.address ?? "",
      goodsAmount,
    )
    ecpayLogisticsId = result.logisticsId
  } else {
    logisticsType = "CVS"
    // cvs_711 -> UNIMARTC2C (店到店), cvs_family -> FAMIC2C
    const cvsType =
      order.shipping_method === "cvs_711" ? "UNIMARTC2C" : "FAMIC2C"
    const result = await createCvsLogistics(
      orderId,
      cvsType as "UNIMARTC2C" | "FAMIC2C",
      address.name,
      address.phone,
      address.email ?? "",
      address.cvs_store_id ?? "",
      goodsAmount,
    )
    ecpayLogisticsId = result.logisticsId
    cvsPaymentNo = result.cvsPaymentNo ?? null
    cvsValidationNo = result.cvsValidationNo ?? null
  }

  const { error } = await supabase.from("logistics").insert({
    order_id: orderId,
    provider: "ecpay",
    type: logisticsType,
    ecpay_logistics_id: ecpayLogisticsId,
    status: "pending",
    cvs_payment_no: cvsPaymentNo,
    cvs_validation_no: cvsValidationNo,
  })

  if (error) {
    console.error(
      `[logistics-creator] failed to insert logistics row for order ${orderId}:`,
      error,
    )
    throw error
  }

  console.log(
    `[logistics-creator] shipment created for order ${orderId}, ecpay_logistics_id=${ecpayLogisticsId}`,
  )
}

/**
 * Create CVS logistics with IsCollection=Y for cvs_cod orders.
 * Called immediately after order creation (not waiting for payment).
 * Payment is confirmed when ECPay webhook fires on LogisticsStatus=3018.
 */
export async function processCreateShipmentCod(orderId: string) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, shipping_method, payment_method, total")
    .eq("id", orderId)
    .single()

  if (!order) throw new Error(`Order ${orderId} not found`)
  if (order.payment_method !== "cvs_cod") {
    console.warn(`[logistics-creator] processCreateShipmentCod called for non-cvs_cod order ${orderId}`)
    return
  }

  // 手動出貨模式：跳過綠界物流，記錄為 manual，由 admin 自行出貨
  const skipEcpay = ((await getSetting("logistics.skip_ecpay")) ?? SETTING_DEFAULTS["logistics.skip_ecpay"]) === "true"
  if (skipEcpay) {
    const { data: existing } = await supabase.from("logistics").select("id").eq("order_id", orderId).not("ecpay_logistics_id", "is", null).limit(1).maybeSingle()
    if (!existing) {
      await supabase.from("logistics").insert({ order_id: orderId, provider: "manual", type: "CVS", status: "pending" })
    }
    console.log(`[logistics-creator] skip_ecpay=true — cvs_cod order ${orderId} recorded as manual shipment`)
    return
  }

  // Idempotency: a SUCCESSFUL logistics row (has ecpay_logistics_id) means done.
  // A prior `failed` row (no ecpay id) must NOT block a retry, so key on the
  // ecpay id rather than mere existence.
  const { data: existing } = await supabase
    .from("logistics")
    .select("id")
    .eq("order_id", orderId)
    .not("ecpay_logistics_id", "is", null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    console.log(`[logistics-creator] logistics already exists for order ${orderId}, skipping`)
    return
  }

  const { data: address } = await supabase
    .from("order_addresses")
    .select("name, phone, email, address, cvs_store_id, cvs_type")
    .eq("order_id", orderId)
    .eq("type", "shipping")
    .maybeSingle()

  if (!address) throw new Error(`Shipping address not found for order ${orderId}`)

  const collectionAmountTwd = Math.round(Number(order.total))
  const cvsType = order.shipping_method === "cvs_711" ? "UNIMARTC2C" : "FAMIC2C"

  let result: Awaited<ReturnType<typeof createCvsLogistics>>
  try {
    result = await createCvsLogistics(
      orderId,
      cvsType as "UNIMARTC2C" | "FAMIC2C",
      address.name,
      address.phone,
      address.email ?? "",
      address.cvs_store_id ?? "",
      collectionAmountTwd, // GoodsAmount = 代收金額 = 訂單總額
      true,                // isCollection = Y
    )
  } catch (err) {
    // Persist the failure so the admin order page can show WHY. The logistics
    // table has no error_message column, so stash the ECPay RtnMsg in
    // raw_response. Replace any prior failed row; re-throw so BullMQ still retries.
    const message = err instanceof Error ? err.message : String(err)
    await supabase.from("logistics").delete().eq("order_id", orderId).is("ecpay_logistics_id", null)
    await supabase.from("logistics").insert({
      order_id: orderId,
      provider: "ecpay",
      type: "CVS",
      status: "failed",
      raw_response: { error: message, failed_at: new Date().toISOString() },
    })
    console.error(`[logistics-creator] CVS COD createCvsLogistics failed for order ${orderId}: ${message}`)
    throw err
  }

  // Success — drop any earlier failed row, then insert the real one.
  await supabase.from("logistics").delete().eq("order_id", orderId).is("ecpay_logistics_id", null)
  const { error } = await supabase.from("logistics").insert({
    order_id: orderId,
    provider: "ecpay",
    type: "CVS",
    ecpay_logistics_id: result.logisticsId,
    status: "pending",
    cvs_payment_no: result.cvsPaymentNo ?? null,
    cvs_validation_no: result.cvsValidationNo ?? null,
  })

  if (error) {
    console.error(`[logistics-creator] failed to insert logistics row for cvs_cod order ${orderId}:`, error)
    throw error
  }

  console.log(
    `[logistics-creator] CVS COD shipment created for order ${orderId}, collection=${collectionAmountTwd} TWD`
  )
}
