import { Router } from "express"
import { supabase } from "../../lib/supabase"
import { buildCheckMacValue, getEcpayCreds } from "../../lib/ecpay-logistics"

export const ecpayLogisticsWebhookRouter = Router()

// POST /webhooks/ecpay-logistics — ECPay logistics status push (form-encoded)
ecpayLogisticsWebhookRouter.post("/", async (req, res) => {
  const params = req.body as Record<string, string>
  const { AllPayLogisticsID, LogisticsStatus, BookingNote, CVSPaymentNo, CVSValidationNo, CheckMacValue } = params

  // Verify CheckMacValue signature
  if (CheckMacValue) {
    const paramsWithoutMac = { ...params }
    delete paramsWithoutMac.CheckMacValue
    const { hashKey, hashIv } = await getEcpayCreds()
    const expected = buildCheckMacValue(paramsWithoutMac, hashKey, hashIv)
    if (CheckMacValue !== expected) {
      console.warn("[webhooks/ecpay-logistics] CheckMacValue mismatch")
      res.status(400).send("0|SignatureError"); return
    }
  }

  if (!AllPayLogisticsID) {
    res.status(400).send("0|MissingLogisticsID"); return
  }

  const statusMap: Record<string, string> = {
    "300": "in_transit",
    "3024": "arrived_cvs",
    "3018": "delivered",
    "3022": "failed",
  }
  const mappedStatus = statusMap[LogisticsStatus] ?? "in_transit"

  // Table is `logistics`; matching column is `ecpay_logistics_id`.
  // `booking_note`/`updated_at` columns don't exist in this schema — store the
  // raw payload in `raw_response` instead.
  const { data: record } = await supabase
    .from("logistics")
    .select("id, order_id")
    .eq("ecpay_logistics_id", AllPayLogisticsID)
    .single()

  if (record) {
    const updatePayload: Record<string, unknown> = {
      status: mappedStatus,
      raw_response: { ...params, BookingNote: BookingNote ?? null },
    }
    if (mappedStatus === "delivered") {
      updatePayload.delivered_at = new Date().toISOString()
    }
    if (mappedStatus === "in_transit") {
      updatePayload.shipped_at = new Date().toISOString()
    }
    if (CVSPaymentNo) updatePayload.cvs_payment_no = CVSPaymentNo
    if (CVSValidationNo) updatePayload.cvs_validation_no = CVSValidationNo

    await supabase
      .from("logistics")
      .update(updatePayload)
      .eq("id", record.id)

    // If arrived at CVS, update order status to indicate ready for pickup
    if (mappedStatus === "arrived_cvs") {
      await supabase
        .from("orders")
        .update({ status: "shipped", updated_at: new Date().toISOString() })
        .eq("id", record.order_id)
    } else if (mappedStatus === "delivered") {
      await supabase
        .from("orders")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", record.order_id)
    }
  }

  res.send("1|OK")
})
