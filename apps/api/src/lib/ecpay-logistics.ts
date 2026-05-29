import { createHash } from "crypto"
import { getApiBaseUrl } from "./urls"

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID ?? ""
const HASH_KEY = process.env.ECPAY_HASH_KEY ?? ""
const HASH_IV = process.env.ECPAY_HASH_IV ?? ""

const BASE_URL = process.env.ECPAY_SANDBOX === "true"
  ? "https://logistics-stage.ecpay.com.tw"
  : "https://logistics.ecpay.com.tw"

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
  orderId: string,
  cvsType: "UNIMART" | "FAMI",
  storeName: string,
  storeId: string
): Promise<CvsLogisticsResult> {
  const merchantTradeNo = `RRL${Date.now()}`
  const apiUrl = getApiBaseUrl()

  const fields: Record<string, string> = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: new Date()
      .toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .replace(/\//g, "/"),
    LogisticsType: "CVS",
    LogisticsSubType: cvsType,
    GoodsAmount: "1",
    GoodsWeight: "1",
    GoodName: "realreal.cc 訂單",
    SenderName: process.env.ECPAY_SENDER_NAME ?? "誠真生活",
    SenderPhone: process.env.ECPAY_SENDER_PHONE ?? "",
    SenderZipCode: process.env.ECPAY_SENDER_ZIP ?? "100",
    SenderAddress: process.env.ECPAY_SENDER_ADDRESS ?? "",
    ReceiverName: storeName,
    ReceiverPhone: process.env.ECPAY_SENDER_PHONE ?? "",
    ReceiverStoreID: storeId,
    ReceiverEmail: "",
    IsCollection: "N",
    ServerReplyURL: `${apiUrl}/webhooks/ecpay-logistics`,
  }
  fields.CheckMacValue = buildCheckMacValue(fields, HASH_KEY, HASH_IV)

  const response = await fetch(`${BASE_URL}/Express/Create`, {
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
  orderId: string,
  receiverName: string,
  receiverPhone: string,
  receiverAddress: string
): Promise<HomeDeliveryResult> {
  const merchantTradeNo = `RRH${Date.now()}`
  const apiUrl = getApiBaseUrl()

  const fields: Record<string, string> = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: new Date()
      .toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .replace(/\//g, "/"),
    LogisticsType: "HOME",
    LogisticsSubType: "TCAT",
    GoodsAmount: "1",
    GoodsWeight: "1",
    GoodName: "realreal.cc 訂單",
    SenderName: process.env.ECPAY_SENDER_NAME ?? "誠真生活",
    SenderPhone: process.env.ECPAY_SENDER_PHONE ?? "",
    SenderZipCode: process.env.ECPAY_SENDER_ZIP ?? "100",
    SenderAddress: process.env.ECPAY_SENDER_ADDRESS ?? "",
    ReceiverName: receiverName,
    ReceiverPhone: receiverPhone,
    ReceiverZipCode: "",
    ReceiverAddress: receiverAddress,
    IsCollection: "N",
    ServerReplyURL: `${apiUrl}/webhooks/ecpay-logistics`,
  }
  fields.CheckMacValue = buildCheckMacValue(fields, HASH_KEY, HASH_IV)

  const response = await fetch(`${BASE_URL}/Express/Create`, {
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
