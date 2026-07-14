import { Router } from "express"
import { supabase } from "../../lib/supabase"
import { buildCheckMacValue, getEcpayCreds } from "../../lib/ecpay-logistics"
import { enqueuePostPaymentJobs } from "../../lib/enqueue-post-payment"

export const ecpayLogisticsWebhookRouter = Router()

// CVS C2C (UNIMARTC2C / FAMIC2C) status codes
const CVS_STATUS_MAP: Record<string, string> = {
  "300": "in_transit",
  "3024": "arrived_cvs",
  "3018": "delivered",
  "3022": "returned",
}

// TCAT / 宅配 (HOME) status codes
const HOME_STATUS_MAP: Record<string, string> = {
  "300": "in_transit",
  "310": "in_transit",
  "311": "in_transit",
  "325": "delivered",
  "326": "returned",
  "327": "returned",
}

// POST /webhooks/ecpay-logistics — ECPay logistics status push (form-encoded)
ecpayLogisticsWebhookRouter.post("/", async (req, res) => {
  const params = req.body as Record<string, string>
  const { AllPayLogisticsID, LogisticsStatus, BookingNote, CVSPaymentNo, CVSValidationNo, CheckMacValue } = params

  // Verify CheckMacValue signature — REQUIRED. Previously this was wrapped in
  // `if (CheckMacValue)`, so simply omitting the field skipped verification and
  // let anyone POST LogisticsStatus=3018 to mark a cvs_cod order paid+completed
  // (and fire points/invoice). Missing signature = reject.
  if (!CheckMacValue) {
    console.warn("[webhooks/ecpay-logistics] missing CheckMacValue — rejected")
    res.status(400).send("0|SignatureMissing"); return
  }
  {
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

  // Table is `logistics`; matching column is `ecpay_logistics_id`.
  // `booking_note`/`updated_at` columns don't exist in this schema — store the
  // raw payload in `raw_response` instead.
  const { data: record } = await supabase
    .from("logistics")
    .select("id, order_id, type")
    .eq("ecpay_logistics_id", AllPayLogisticsID)
    .single()

  // Pick map by record.type — default to CVS to preserve historical behaviour
  const statusMap = record?.type === "HOME" ? HOME_STATUS_MAP : CVS_STATUS_MAP
  const mappedStatus = statusMap[LogisticsStatus] ?? "in_transit"

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

    // Fetch the current order.status so we can make conditional updates
    // (e.g. only upgrade processing → shipped on in_transit, never downgrade).
    const { data: orderRow } = await supabase
      .from("orders")
      .select("status")
      .eq("id", record.order_id)
      .single()
    const currentOrderStatus = orderRow?.status

    if (mappedStatus === "arrived_cvs") {
      // CVS 到店待取 → 訂單視為已出貨。守衛:遲到 / 亂序的到店 callback 不可把
      // 已完成 / 已取消 / 失敗的訂單降級回 shipped —— 只從 pending / processing 前進。
      await supabase
        .from("orders")
        .update({ status: "shipped", updated_at: new Date().toISOString() })
        .eq("id", record.order_id)
        .in("status", ["pending", "processing"])
    } else if (mappedStatus === "delivered") {
      const now = new Date().toISOString()

      // 取得訂單付款方式，判斷是否為 CVS COD
      const { data: orderForCod } = await supabase
        .from("orders")
        .select("payment_method, payment_status")
        .eq("id", record.order_id)
        .single()

      if (orderForCod?.payment_method === "cvs_cod" && orderForCod.payment_status !== "paid") {
        // CVS COD：顧客取貨付款，ECPay 代收完成 → 確認付款
        await supabase
          .from("orders")
          .update({
            payment_status: "paid",
            status: "completed",
            completed_at: now,
            updated_at: now,
          })
          .eq("id", record.order_id)

        // 觸發 post-payment jobs（email/發票/點數/升等）
        try {
          await enqueuePostPaymentJobs(record.order_id)
        } catch (err) {
          console.warn("[webhooks/ecpay-logistics] enqueuePostPaymentJobs failed for cvs_cod:", err)
        }
      } else {
        // 非 COD 訂單：只更新 order.status
        await supabase
          .from("orders")
          .update({ status: "completed", completed_at: now, updated_at: now })
          .eq("id", record.order_id)
      }
    } else if (mappedStatus === "returned") {
      // 超過期限未取 / 退件 → 訂單標記 failed + 寫入原因。
      // 守衛:已付款(預付已收款 / COD 已代收完成)或已完成的訂單,絕不能被退件
      // callback 靜默改成 failed —— 那是「已收款但退貨」需人工走退款的情境,不是
      // 付款失敗;只有「未付款」的訂單(例如 COD 取貨前逾期未取)退件才標 failed。
      // 與 pchomepay #10000035 同一道防護:遲到 / 重複 callback 不覆蓋已付款單。
      const { data: flipped } = await supabase
        .from("orders")
        .update({
          status: "failed",
          failed_reason: "returned_unclaimed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", record.order_id)
        .neq("payment_status", "paid")
        .neq("status", "completed")
        .select("id")
      if (!flipped || flipped.length === 0) {
        console.warn(
          `[webhooks/ecpay-logistics] returned callback ignored for order ${record.order_id} (already paid/completed) — needs manual refund review`,
        )
      }
    } else if (mappedStatus === "in_transit" && currentOrderStatus === "processing") {
      // 物流商收件 / 配送中 → 從 processing 升級成 shipped
      // 已是 shipped/completed/failed/cancelled 就不動，避免覆寫更後面的狀態
      await supabase
        .from("orders")
        .update({ status: "shipped", updated_at: new Date().toISOString() })
        .eq("id", record.order_id)
    }
  }

  res.send("1|OK")
})
