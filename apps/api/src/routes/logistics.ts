import { Router } from "express"
import { buildCheckMacValue, getEcpayCreds, buildC2CPrintForm } from "../lib/ecpay-logistics"
import { getApiBaseUrl, getSiteUrl } from "../lib/urls"
import { supabase } from "../lib/supabase"
import { requireAuth } from "../middleware/auth"
import { requireAdmin } from "../middleware/admin"

export const logisticsRouter = Router()

// GET /logistics/print/:orderId — admin opens ECPay's C2C 寄件單 print page.
// Returns an auto-submitting form that POSTs to ECPay's print endpoint; the
// admin prints the label and takes the package (with the CVS code) to a store.
logisticsRouter.get("/print/:orderId", requireAuth, requireAdmin, async (req, res) => {
  const { data: logistics } = await supabase
    .from("logistics")
    .select("ecpay_logistics_id, type, cvs_payment_no, cvs_validation_no, raw_response")
    .eq("order_id", req.params.orderId)
    .limit(1)
    .maybeSingle()

  if (!logistics || !logistics.ecpay_logistics_id) {
    res.status(404).send("此訂單尚無綠界物流單"); return
  }
  if (logistics.type === "HOME") {
    res.status(400).send("宅配訂單無 C2C 寄件單"); return
  }
  if (!logistics.cvs_payment_no || !logistics.cvs_validation_no) {
    res.status(400).send("缺 CVS 寄件編號，無法列印（物流單可能尚未建立完成）"); return
  }

  const html = await buildC2CPrintForm(logistics)
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(html)
})

// GET /logistics/map — Generate ECPay store map selection form (auto-submits)
logisticsRouter.get("/map", async (req, res) => {
  // ECPay scopes credentials per channel: UNIMART = 7-11 B2C (廠商到店),
  // UNIMARTC2C = 7-11 C2C (店到店). Consumer-checkout merchants are
  // provisioned for C2C; using UNIMART triggers "找不到加密金鑰".
  const logisticsSubType = (req.query.logisticsSubType as string) ?? "UNIMARTC2C"
  const isCollection = (req.query.isCollection as string) ?? "N"

  const merchantTradeNo = `MAP${Date.now()}`
  const c = await getEcpayCreds()
  const mapUrl = `${c.baseUrl}/Express/map`

  const fields: Record<string, string> = {
    MerchantID: c.merchantId,
    MerchantTradeNo: merchantTradeNo,
    LogisticsType: "CVS",
    LogisticsSubType: logisticsSubType,
    IsCollection: isCollection,
    ServerReplyURL: `${getApiBaseUrl()}/logistics/map-result`,
  }
  fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)

  // Build hidden form fields
  const hiddenInputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}" />`)
    .join("\n      ")

  const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>ECPay Store Map</title></head>
  <body>
    <form id="ecpay-map-form" method="POST" action="${escapeHtml(mapUrl)}">
      ${hiddenInputs}
    </form>
    <script>document.getElementById("ecpay-map-form").submit();</script>
  </body>
</html>`

  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.send(html)
})

// POST /logistics/map-result — Receive store selection result from ECPay
logisticsRouter.post("/map-result", (req, res) => {
  const {
    CVSStoreID,
    CVSStoreName,
    CVSAddress,
    LogisticsSubType,
  } = req.body as Record<string, string>

  // Redirect to frontend checkout page with store info as query params
  const params = new URLSearchParams()
  if (CVSStoreID) params.set("cvsStoreId", CVSStoreID)
  if (CVSStoreName) params.set("cvsStoreName", CVSStoreName)
  if (CVSAddress) params.set("cvsAddress", CVSAddress)
  if (LogisticsSubType) params.set("logisticsSubType", LogisticsSubType)

  res.redirect(`${getSiteUrl()}/checkout?${params.toString()}`)
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
