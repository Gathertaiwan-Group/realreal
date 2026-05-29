import { Router } from "express"
import { buildCheckMacValue } from "../lib/ecpay-logistics"

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID ?? ""
const HASH_KEY = process.env.ECPAY_HASH_KEY ?? ""
const HASH_IV = process.env.ECPAY_HASH_IV ?? ""

const MAP_URL = process.env.ECPAY_SANDBOX === "true"
  ? "https://logistics-stage.ecpay.com.tw/Express/map"
  : "https://logistics.ecpay.com.tw/Express/map"

const RAILWAY_API_URL = process.env.RAILWAY_API_URL ?? "http://localhost:4000"
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"

export const logisticsRouter = Router()

// GET /logistics/map — Generate ECPay store map selection form (auto-submits)
logisticsRouter.get("/map", (req, res) => {
  // ECPay scopes credentials per channel: UNIMART = 7-11 B2C (廠商到店),
  // UNIMARTC2C = 7-11 C2C (店到店). Consumer-checkout merchants are
  // provisioned for C2C; using UNIMART triggers "找不到加密金鑰".
  const logisticsSubType = (req.query.logisticsSubType as string) ?? "UNIMARTC2C"
  const isCollection = (req.query.isCollection as string) ?? "N"

  const merchantTradeNo = `MAP${Date.now()}`

  const fields: Record<string, string> = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    LogisticsType: "CVS",
    LogisticsSubType: logisticsSubType,
    IsCollection: isCollection,
    ServerReplyURL: `${RAILWAY_API_URL}/logistics/map-result`,
  }
  fields.CheckMacValue = buildCheckMacValue(fields, HASH_KEY, HASH_IV)

  // Build hidden form fields
  const hiddenInputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}" />`)
    .join("\n      ")

  const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>ECPay Store Map</title></head>
  <body>
    <form id="ecpay-map-form" method="POST" action="${escapeHtml(MAP_URL)}">
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

  res.redirect(`${SITE_URL}/checkout?${params.toString()}`)
})

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}
