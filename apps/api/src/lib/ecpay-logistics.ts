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
): Promise<CvsLogisticsResult> {
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
    GoodsAmount: "1",
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
  receiverAddress: string
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
    GoodsAmount: "1",
    GoodsWeight: "1",
    GoodsName: "realreal.cc 訂單",
    SenderName: c.senderName,
    SenderPhone: c.senderPhone,
    SenderZipCode: c.senderZip,
    SenderAddress: c.senderAddress,
    ReceiverName: receiverName,
    ReceiverPhone: receiverPhone,
    ReceiverZipCode: "",
    ReceiverAddress: receiverAddress,
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
  logistics: { ecpay_logistics_id: string; type: string; raw_response: any }
): Promise<{ ok: boolean; message: string; raw: string }> {
  const c = await getEcpayCreds()
  const merchantTradeNo = logistics.raw_response?.MerchantTradeNo
  if (!merchantTradeNo) return { ok: false, message: "缺 MerchantTradeNo", raw: "" }

  // ECPay endpoint: POST {base}/Helper/LogisticsTradeCancel
  // Fields: MerchantID, MerchantTradeNo, AllPayLogisticsID, LogisticsType,
  //         LogisticsSubType, CheckMacValue
  // NOTE: endpoint path flagged uncertain in spec — verify against ECPay
  //       全站宅配技術文件 v2.0.16+ in sandbox before production rollout.
  const fields: Record<string, string> = {
    MerchantID: c.merchantId,
    MerchantTradeNo: merchantTradeNo,
    AllPayLogisticsID: logistics.ecpay_logistics_id,
    // type=CVS/HOME 推回 LogisticsType (CVS/HOME) and LogisticsSubType (UNIMARTC2C/FAMIC2C/TCAT)
    LogisticsType: logistics.type === "HOME" ? "HOME" : "CVS",
    LogisticsSubType: logistics.raw_response?.LogisticsSubType ?? "",
  }
  fields.CheckMacValue = buildCheckMacValue(fields, c.hashKey, c.hashIv)

  const resp = await fetch(`${c.baseUrl}/Helper/LogisticsTradeCancel`, {
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
