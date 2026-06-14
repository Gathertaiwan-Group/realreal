import axios from "axios"
import { createHash } from "crypto"
import { getSettingOrEnv } from "./settings"

/**
 * Amego e-invoice API client.
 * Ported from the proven production WordPress integration (V14).
 *
 *   Issue : POST {base}/json/c0401
 *   Void  : POST {base}/json/c0701
 *   Auth  : form body { invoice: taxId, data: <json>, time: <unix>,
 *                       sign: md5(data + time + appKey) }
 *
 * Authoritative amount = the order total actually charged. Item lines are
 * reconciled to it with a "系統尾差調整" rounding line when they differ.
 */

async function amegoConfig() {
  const [taxId, appKey, sandbox] = await Promise.all([
    getSettingOrEnv("amego.tax_id", "AMEGO_TAX_ID"),
    getSettingOrEnv("amego.app_key", "AMEGO_APP_KEY"),
    getSettingOrEnv("amego.sandbox", "AMEGO_SANDBOX"),
  ])
  if (!taxId || !appKey) {
    throw new Error("Missing Amego TAX_ID / APP_KEY (check /admin/settings or env)")
  }
  // Amego sandbox vs production: same host today, but keep the toggle wired
  // so we can swap easily if they introduce a staging URL.
  const baseUrl =
    process.env.AMEGO_API_URL ??
    (sandbox === "true"
      ? "https://invoice-api.amego.tw"
      : "https://invoice-api.amego.tw")
  return { taxId, appKey, baseUrl }
}

async function amegoPost<T>(path: string, payload: unknown): Promise<T> {
  const { taxId, appKey, baseUrl } = await amegoConfig()
  const data = JSON.stringify(payload)
  const time = Math.floor(Date.now() / 1000)
  const sign = createHash("md5").update(data + String(time) + appKey).digest("hex")

  const body = new URLSearchParams({
    invoice: taxId,
    data,
    time: String(time),
    sign,
  })

  const res = await axios.post(`${baseUrl}${path}`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 45000,
  })
  return res.data as T
}

export type InvoiceType = "B2C_2" | "B2C_3" | "B2B"

export interface IssueInvoiceParams {
  orderId: string
  orderNumber: string
  /** Order total actually paid — the authoritative figure. */
  amount: number
  /** Ignored: tax is recomputed from amount + buyer type (B2B vs B2C). */
  taxAmount: number
  type: InvoiceType
  buyerEmail?: string
  carrierType?: "phone" | "natural_person" | "love_code" | "member" | null
  carrierNumber?: string
  loveCode?: string
  /** Company unified business number → triggers a B2B (三聯式) invoice. */
  taxId?: string
  companyTitle?: string
  items: Array<{ name: string; qty: number; unitPrice: number }>
}

interface AmegoIssueResponse {
  code: number
  msg?: string
  invoice_number?: string
  random_number?: string
  RandomNumber?: string
}

export async function issueInvoice(params: IssueInvoiceParams) {
  const realTotal = Math.round(params.amount)

  // 1) Product line items
  const productItems: Array<Record<string, unknown>> = params.items.map((it) => ({
    Description: it.name,
    Quantity: it.qty,
    UnitPrice: Math.round(it.unitPrice),
    Amount: Math.round(it.unitPrice * it.qty),
    Remark: "",
    TaxType: "1",
  }))
  const itemsTotal = productItems.reduce((s, p) => s + (p.Amount as number), 0)

  // 2) Auto rounding adjustment — item sum must equal the amount charged
  const diff = realTotal - itemsTotal
  if (diff !== 0) {
    productItems.push({
      Description: "系統尾差調整",
      Quantity: 1,
      UnitPrice: diff,
      Amount: diff,
      Remark: "Rounding adjustment",
      TaxType: "1",
    })
  }

  // 3) Buyer + tax: B2B (has company tax id) vs B2C
  const isB2B = !!params.taxId
  const buyerId = isB2B ? params.taxId! : "0000000000"
  const taxAmount = isB2B ? Math.round(realTotal - realTotal / 1.05) : 0
  const salesAmount = realTotal - taxAmount

  // 4) Carrier / donation (B2C only)
  const carrier: Record<string, unknown> = {}
  if (!isB2B) {
    if (params.carrierType === "love_code" && params.loveCode) {
      carrier.NPOBAN = params.loveCode
    } else if (params.carrierType === "phone" && params.carrierNumber) {
      carrier.CarrierType = "3J0002" // 手機條碼
      carrier.CarrierId1 = params.carrierNumber
      carrier.CarrierId2 = params.carrierNumber
    } else if (params.carrierType === "natural_person" && params.carrierNumber) {
      carrier.CarrierType = "CQ0001" // 自然人憑證
      carrier.CarrierId1 = params.carrierNumber
      carrier.CarrierId2 = params.carrierNumber
    }
    // "member" / null → no carrier (Amego cloud invoice, like the V14 default)
  }

  const payload = {
    // The customer-facing order number (RR…), NOT the internal UUID order.id —
    // this is what shows as 訂單編號 in the Amego invoice backend, so it must
    // match the website's order number. Fall back to orderId only if missing.
    OrderId: params.orderNumber || params.orderId,
    BuyerIdentifier: buyerId,
    BuyerName: params.companyTitle || (isB2B ? "公司" : "消費者"),
    BuyerEmailAddress: params.buyerEmail ?? "",
    ProductItem: productItems,
    SalesAmount: salesAmount,
    FreeTaxSalesAmount: 0,
    ZeroTaxSalesAmount: 0,
    TaxType: "1",
    TaxRate: 0.05,
    TaxAmount: taxAmount,
    TotalAmount: realTotal,
    ...carrier,
  }

  const res = await amegoPost<AmegoIssueResponse>("/json/c0401", payload)
  if (res.code !== 0 || !res.invoice_number) {
    throw new Error(`Amego issue failed: ${res.msg ?? JSON.stringify(res)}`)
  }
  return {
    invoiceNumber: res.invoice_number,
    randomCode: res.random_number ?? res.RandomNumber ?? "",
    // Amego identifies/voids an invoice by its invoice number.
    amegoId: res.invoice_number,
  }
}

/**
 * 作廢發票 (Void invoice).
 *
 * Amego endpoint map (verified 2026-05-30):
 *   - /json/c0701 = 註銷 (annul — used pre-MOF-upload, treated by Amego as
 *     "never delivered to buyer"). Showed as 發票註銷 in Amego console.
 *   - /json/f0501 = 作廢 (void — used post-delivery). Showed as 發票作廢.
 *     New path as of 2025-01-06; legacy /json/c0501 still works.
 *
 * We always want 作廢 semantics for refunds/cancellations — the invoice
 * was already delivered to the customer (digital), so a void must leave
 * a record. Fields per MOF MIG C0501 spec: CancelInvoiceNumber +
 * CancelDate (YYYYMMDD) + CancelTime (HH:MM:SS) + CancelReason.
 */
export async function voidInvoice(invoiceNumber: string, reason: string) {
  const now = new Date()
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000) // UTC+8
  const yyyymmdd =
    tw.getUTCFullYear().toString() +
    String(tw.getUTCMonth() + 1).padStart(2, "0") +
    String(tw.getUTCDate()).padStart(2, "0")
  const hhmmss =
    String(tw.getUTCHours()).padStart(2, "0") +
    ":" +
    String(tw.getUTCMinutes()).padStart(2, "0") +
    ":" +
    String(tw.getUTCSeconds()).padStart(2, "0")

  const res = await amegoPost<{ code: number; msg?: string }>("/json/f0501", [
    {
      CancelInvoiceNumber: invoiceNumber,
      CancelDate: yyyymmdd,
      CancelTime: hhmmss,
      CancelReason: reason || "訂單取消",
    },
  ])
  if (res.code !== 0) {
    throw new Error(`Amego void failed: ${res.msg ?? JSON.stringify(res)}`)
  }
  return res
}

export async function queryInvoice(invoiceNumber: string) {
  return amegoPost("/json/invoice_query", [{ InvoiceNumber: invoiceNumber }])
}

export function invoicePdfUrl(invoiceNumber: string) {
  // PDFs are served from the same host as the API. Sandbox/prod toggle is
  // resolved inside amegoConfig() at call-time; here we use the env default
  // since this returns a plain URL (no async).
  const base = process.env.AMEGO_API_URL ?? "https://invoice-api.amego.tw"
  return `${base}/invoice/pdf/${invoiceNumber}`
}
