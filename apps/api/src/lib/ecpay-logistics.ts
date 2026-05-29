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
  storeName: string,
  storeId: string
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
    GoodName: "realreal.cc 訂單",
    SenderName: c.senderName,
    SenderPhone: c.senderPhone,
    SenderZipCode: c.senderZip,
    SenderAddress: c.senderAddress,
    ReceiverName: storeName,
    ReceiverPhone: c.senderPhone,
    ReceiverStoreID: storeId,
    ReceiverEmail: "",
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
    throw new Error(`ECPay Logistics CVS error: ${result.RtnCode} ${result.RtnMsg}`)
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
    GoodName: "realreal.cc 訂單",
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
