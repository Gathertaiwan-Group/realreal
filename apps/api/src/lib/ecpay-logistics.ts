import { createHash } from "crypto"
import { getApiBaseUrl } from "./urls"
import { getSettingOrEnv } from "./settings"

interface EcpayCreds {
  merchantId: string
  hashKey: string
  hashIv: string
  baseUrl: string
  senderName: string
  senderPhone: string
  senderZip: string
  senderCity: string
  senderAddress: string
}

export async function getEcpayCreds(): Promise<EcpayCreds> {
  const [
    merchantId,
    hashKey,
    hashIv,
    sandbox,
    senderName,
    senderPhone,
    senderZip,
    senderCity,
    senderAddress,
  ] = await Promise.all([
    getSettingOrEnv("ecpay.merchant_id", "ECPAY_MERCHANT_ID"),
    getSettingOrEnv("ecpay.hash_key", "ECPAY_HASH_KEY"),
    getSettingOrEnv("ecpay.hash_iv", "ECPAY_HASH_IV"),
    getSettingOrEnv("ecpay.sandbox", "ECPAY_SANDBOX"),
    getSettingOrEnv("ecpay.sender_name", "ECPAY_SENDER_NAME", "誠真生活"),
    getSettingOrEnv("ecpay.sender_phone", "ECPAY_SENDER_PHONE"),
    getSettingOrEnv("ecpay.sender_zip", "ECPAY_SENDER_ZIP", "100"),
    getSettingOrEnv("ecpay.sender_city", "ECPAY_SENDER_CITY"),
    getSettingOrEnv("ecpay.sender_address", "ECPAY_SENDER_ADDRESS"),
  ])
  return {
    merchantId,
    hashKey,
    hashIv,
    baseUrl:
      sandbox === "true"
        ? "https://logistics-stage.ecpay.com.tw"
        : "https://logistics.ecpay.com.tw",
    senderName,
    senderPhone,
    senderZip,
    senderCity,
    senderAddress,
  }
}

export function buildCheckMacValue(params: Record<string, string>, hashKey: string, hashIV: string): string {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k}=${params[k]}`)
    .join("&")
  const raw = `HashKey=${hashKey}&${sorted}&HashIV=${hashIV}`
  const encoded = encodeURIComponent(raw).toLowerCase()
    .replace(/%20/g, "+").replace(/%21/g, "!").replace(/%28/g, "(").replace(/%29/g, ")")
    .replace(/%2a/g, "*").replace(/%2d/g, "-").replace(/%2e/g, ".").replace(/%5f/g, "_")
  return createHash("md5").update(encoded).digest("hex").toUpperCase()
}

export interface CvsLogisticsResult {
  logisticsId: string
  cvsPaymentNo?: string
  cvsValidationNo?: string
}

export async function createCvsLogistics(
  _orderId: string,
  cvsType: "UNIMARTC2C" | "FAMIC2C",
  receiverName: string,
  receiverPhone: string,
  receiverEmail: string,
  storeId: string,
  goodsAmount: number,
  isCollection: boolean = false,
): Promise<CvsLogisticsResult> {
  // For ECPay C2C (UNIMART/FAMI) the amount the store collects under COD is the
  // GoodsAmount itself — CollectionAmount alone does NOT drive C2C 代收. Passing
  // GoodsAmount="1" meant COD customers were charged NT$1. Always declare the
  // real order value. (min 1, integer TWD per ECPay.)
  const goods = String(Math.max(1, Math.round(goodsAmount)))
  const merchantTradeNo = `RRL${Date.now()}`
  const apiUrl = getApiBaseUrl()
  const c = await getEcpayCreds()

  const fields: Record<string, string> = {
    MerchantID: c.merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: new Date()
      .toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .replace(/\//g, "/"),
    LogisticsType: "CVS",
    LogisticsSubType: cvsType,
    GoodsAmount: goods,
    GoodsWeight: "1",
    GoodsName: "realreal.cc 訂單",
    SenderName: c.senderName,
    // ECPay C2C (UNIMARTC2C/FAMIC2C) requires SenderCellPhone (mobile);
    // SenderPhone (landline) is for B2C only and gets rejected with
    // 10500047 if used on C2C. ZipCode + Address are still required.
    SenderCellPhone: c.senderPhone,
    SenderZipCode: c.senderZip,
    SenderAddress: c.senderAddress,
    // ReceiverName / Phone are the END CUSTOMER's — not the store.
    // ECPay sends SMS pickup notifications to ReceiverCellPhone, so this
    // must be the buyer's mobile or the customer never gets the pickup code.
    ReceiverName: receiverName,
    ReceiverCellPhone: receiverPhone,
    ReceiverStoreID: storeId,
    ReceiverEmail: receiverEmail,
    IsCollection: isCollection ? "Y" : "N",
    ServerReplyURL: `${apiUrl}/webhooks/ecpay-logistics`,
  }
  if (isCollection) {
    fields.CollectionAmount = goods
  }
  fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)

  const response = await fetch(`${c.baseUrl}/Express/Create`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  })
  const text = await response.text()
  const result = Object.fromEntries(new URLSearchParams(text))

  if (result.RtnCode !== "1") {
    // Surface the raw response so we don't lose what ECPay actually said
    // when the body isn't the expected key=value form.
    throw new Error(
      `ECPay Logistics CVS error: RtnCode=${result.RtnCode ?? "?"} RtnMsg=${result.RtnMsg ?? "?"} raw=${text.slice(0, 500)}`,
    )
  }

  return {
    logisticsId: result.AllPayLogisticsID,
    cvsPaymentNo: result.CVSPaymentNo,
    cvsValidationNo: result.CVSValidationNo,
  }
}

export interface HomeDeliveryResult {
  logisticsId: string
  bookingNote?: string
}

export async function createHomeDelivery(
  _orderId: string,
  receiverName: string,
  receiverPhone: string,
  receiverZip: string,
  receiverCity: string,
  receiverAddress: string,
  goodsAmount: number,
): Promise<HomeDeliveryResult> {
  const merchantTradeNo = `RRH${Date.now()}`
  const apiUrl = getApiBaseUrl()
  const c = await getEcpayCreds()

  const fields: Record<string, string> = {
    MerchantID: c.merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: new Date()
      .toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .replace(/\//g, "/"),
    LogisticsType: "HOME",
    LogisticsSubType: "TCAT",
    GoodsAmount: String(Math.max(1, Math.round(goodsAmount))),
    GoodsWeight: "1",
    GoodsName: "realreal.cc 訂單",
    SenderName: c.senderName,
    SenderPhone: c.senderPhone,
    SenderZipCode: c.senderZip,
    SenderAddress: c.senderAddress,
    ReceiverName: receiverName,
    ReceiverPhone: receiverPhone,
    // ECPay HOME/TCAT requires a non-empty ReceiverZipCode; it was hardcoded ""
    // which rejected every home-delivery booking. City is prefixed onto the
    // address line so the courier has the full address.
    ReceiverZipCode: receiverZip || "",
    ReceiverAddress: `${receiverCity}${receiverAddress}`.trim() || receiverAddress,
    IsCollection: "N",
    ServerReplyURL: `${apiUrl}/webhooks/ecpay-logistics`,
  }
  fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)

  const response = await fetch(`${c.baseUrl}/Express/Create`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  })
  const text = await response.text()
  const result = Object.fromEntries(new URLSearchParams(text))

  if (result.RtnCode !== "1") {
    throw new Error(`ECPay Logistics home delivery error: ${result.RtnCode} ${result.RtnMsg}`)
  }

  return {
    logisticsId: result.AllPayLogisticsID,
    bookingNote: result.BookingNote,
  }
}

export async function cancelEcpayLogistics(
  logistics: {
    ecpay_logistics_id: string
    type: string
    cvs_payment_no?: string | null
    cvs_validation_no?: string | null
    raw_response: any
  },
): Promise<{ ok: boolean; message: string; raw: string }> {
  const c = await getEcpayCreds()

  // Only CVS C2C orders can be cancelled this way. HOME/TCAT has no equivalent
  // self-service cancel — surface that so the admin handles it via ECPay 客服.
  if (logistics.type === "HOME") {
    return { ok: false, message: "宅配訂單不支援線上取消，請聯繫綠界客服", raw: "" }
  }

  const cvsPaymentNo = logistics.cvs_payment_no ?? logistics.raw_response?.CVSPaymentNo
  const cvsValidationNo = logistics.cvs_validation_no ?? logistics.raw_response?.CVSValidationNo
  if (!cvsPaymentNo || !cvsValidationNo) {
    return { ok: false, message: "缺 CVSPaymentNo / CVSValidationNo（C2C 取消必填）", raw: "" }
  }

  // ECPay C2C cancel endpoint: POST {base}/Express/CancelC2COrder
  // Fields (per official SDK): MerchantID, AllPayLogisticsID, CVSPaymentNo,
  // CVSValidationNo, CheckMacValue. (The old /Helper/LogisticsTradeCancel path
  // was wrong and always failed.)
  const fields: Record<string, string> = {
    MerchantID: c.merchantId,
    AllPayLogisticsID: logistics.ecpay_logistics_id,
    CVSPaymentNo: String(cvsPaymentNo),
    CVSValidationNo: String(cvsValidationNo),
  }
  fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)

  const resp = await fetch(`${c.baseUrl}/Express/CancelC2COrder`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  })
  const text = await resp.text()
  const [code, ...msgParts] = text.split("|")
  return {
    ok: code === "1",
    message: msgParts.join("|") || `RtnCode=${code}`,
    raw: text,
  }
}

/**
 * Build the auto-submitting HTML form that opens ECPay's C2C 寄件單 print page.
 * The merchant MUST print this and take the package (with CVSPaymentNo) to a
 * store to actually ship a C2C order — there is no other way to fulfil it.
 * 7-11 → PrintUniMartC2COrderInfo, 全家 → PrintFAMIC2COrderInfo.
 */
export async function buildC2CPrintForm(logistics: {
  ecpay_logistics_id: string
  cvs_payment_no?: string | null
  cvs_validation_no?: string | null
  raw_response: any
}): Promise<string> {
  const c = await getEcpayCreds()
  const cvsPaymentNo = logistics.cvs_payment_no ?? logistics.raw_response?.CVSPaymentNo
  const cvsValidationNo = logistics.cvs_validation_no ?? logistics.raw_response?.CVSValidationNo
  const subType: string = logistics.raw_response?.LogisticsSubType ?? "UNIMARTC2C"

  const printPath = subType.startsWith("FAMI")
    ? "/Express/PrintFAMIC2COrderInfo"
    : "/Express/PrintUniMartC2COrderInfo"

  const fields: Record<string, string> = {
    MerchantID: c.merchantId,
    AllPayLogisticsID: logistics.ecpay_logistics_id,
    CVSPaymentNo: String(cvsPaymentNo ?? ""),
    CVSValidationNo: String(cvsValidationNo ?? ""),
  }
  fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)

  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtmlAttr(v)}" />`)
    .join("\n      ")
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>ECPay 寄件單</title></head>
<body>
  <form id="ecpay-print" method="POST" action="${c.baseUrl}${printPath}">
    ${inputs}
  </form>
  <script>document.getElementById("ecpay-print").submit();</script>
</body></html>`
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
