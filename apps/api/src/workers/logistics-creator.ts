import { supabase } from "../lib/supabase"
import { createCvsLogistics, createHomeDelivery } from "../lib/ecpay-logistics"

export async function processCreateShipment(orderId: string) {
  // Fetch order with address
  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, shipping_method, status")
    .eq("id", orderId)
    .single()

  if (!order) throw new Error(`Order ${orderId} not found`)
  if (order.status !== "paid") {
    console.log(`[logistics-creator] order ${orderId} status is "${order.status}", skipping`)
    return
  }

  // Check if a logistics record already exists (idempotency)
  const { data: existing } = await supabase
    .from("logistics_records")
    .select("id")
    .eq("order_id", orderId)
    .limit(1)
    .single()

  if (existing) {
    console.log(`[logistics-creator] logistics record already exists for order ${orderId}, skipping`)
    return
  }

  const { data: address } = await supabase
    .from("order_addresses")
    .select("name, phone, address, cvs_store_id, cvs_type")
    .eq("order_id", orderId)
    .single()

  if (!address) throw new Error(`Address not found for order ${orderId}`)

  let logisticsId: string
  let cvsPaymentNo: string | null = null
  let cvsValidationNo: string | null = null

  if (order.shipping_method === "home_delivery") {
    const result = await createHomeDelivery(
      orderId,
      address.name,
      address.phone,
      address.address ?? ""
    )
    logisticsId = result.logisticsId
  } else {
    // CVS: cvs_711 -> UNIMART, cvs_family -> FAMI
    const cvsType = order.shipping_method === "cvs_711" ? "UNIMART" : "FAMI"
    const result = await createCvsLogistics(
      orderId,
      cvsType as "UNIMART" | "FAMI",
      address.name,
      address.cvs_store_id ?? ""
    )
    logisticsId = result.logisticsId
    cvsPaymentNo = result.cvsPaymentNo ?? null
    cvsValidationNo = result.cvsValidationNo ?? null
  }

  // Insert logistics record
  const { error } = await supabase
    .from("logistics_records")
    .insert({
      order_id: orderId,
      logistics_id: logisticsId,
      shipping_method: order.shipping_method,
      status: "created",
      cvs_payment_no: cvsPaymentNo,
      cvs_validation_no: cvsValidationNo,
    })

  if (error) {
    console.error(`[logistics-creator] failed to insert logistics record for order ${orderId}:`, error)
    throw error
  }

  console.log(`[logistics-creator] shipment created for order ${orderId}, logisticsId=${logisticsId}`)
}
