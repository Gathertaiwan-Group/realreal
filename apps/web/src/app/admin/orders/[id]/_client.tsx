"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  FileText,
  RefreshCw,
  Ban,
  ExternalLink,
  Truck,
  Copy,
  Check,
} from "lucide-react"
import { toast } from "sonner"
import {
  reissueInvoiceAction,
  retryShipmentAction,
  updateOrderStatusAction,
  voidInvoiceAction,
} from "./actions"

const STATUS_LABEL: Record<string, string> = {
  pending: "待付款",
  processing: "處理中",
  shipped: "已出貨",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失敗",
}

/* ---------- Action Buttons ---------- */

interface OrderActionsProps {
  orderId: string
  status: string
  paymentStatus: string
}

export function OrderActions({ orderId, status, paymentStatus }: OrderActionsProps) {
  const [isPending, startTransition] = useTransition()

  function handleAction(newStatus: string) {
    startTransition(() => updateOrderStatusAction(orderId, newStatus))
  }

  const showConfirmPayment = status === "pending" && paymentStatus !== "paid"
  const showShip = status === "processing"
  const showComplete = status === "shipped"
  const showCancel = status === "pending" || status === "processing"

  if (!showConfirmPayment && !showShip && !showComplete && !showCancel) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {showConfirmPayment && (
        <Button size="sm" disabled={isPending} onClick={() => handleAction("processing")}>
          確認付款
        </Button>
      )}
      {showShip && (
        <Button size="sm" disabled={isPending} onClick={() => handleAction("shipped")}>
          出貨
        </Button>
      )}
      {showComplete && (
        <Button size="sm" variant="secondary" disabled={isPending} onClick={() => handleAction("completed")}>
          完成訂單
        </Button>
      )}
      {showCancel && (
        <Button size="sm" variant="destructive" disabled={isPending} onClick={() => handleAction("cancelled")}>
          取消訂單
        </Button>
      )}
    </div>
  )
}

/* ---------- Order Timeline ---------- */

const TIMELINE_STEPS = [
  { key: "pending", label: "訂單建立" },
  { key: "processing", label: "確認付款" },
  { key: "shipped", label: "已出貨" },
  { key: "completed", label: "已完成" },
] as const

interface OrderTimelineProps {
  status: string
  createdAt: string
}

export function OrderTimeline({ status, createdAt }: OrderTimelineProps) {
  const isCancelled = status === "cancelled" || status === "failed"
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.key === status)

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto py-2">
      {TIMELINE_STEPS.map((step, i) => {
        const isReached = !isCancelled && i <= currentIndex
        const isCurrent = !isCancelled && step.key === status
        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  isCurrent
                    ? "bg-zinc-900 text-white ring-2 ring-zinc-900/20"
                    : isReached
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-200 text-zinc-400"
                }`}
              >
                {i + 1}
              </div>
              <span className={`text-xs whitespace-nowrap ${isReached ? "text-zinc-900 font-medium" : "text-zinc-400"}`}>
                {step.label}
              </span>
            </div>
            {i < TIMELINE_STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 ${
                  !isCancelled && i < currentIndex ? "bg-zinc-900" : "bg-zinc-200"
                }`}
              />
            )}
          </div>
        )
      })}

      {isCancelled && (
        <div className="flex flex-col items-center gap-1 ml-4">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 bg-red-600 text-white">
            ✕
          </div>
          <span className="text-xs whitespace-nowrap text-red-600 font-medium">
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>
      )}
    </div>
  )
}

/* ---------- Invoice Card ---------- */

const INVOICE_STATUS_LABEL: Record<string, string> = {
  pending: "待開立",
  issued: "已開立",
  voided: "已作廢",
  failed: "開立失敗",
}

const INVOICE_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "outline",
  issued: "default",
  voided: "destructive",
  failed: "destructive",
}

interface InvoiceCardProps {
  orderId: string
  invoice: {
    id: string
    invoice_number: string | null
    status: string
    type?: string | null
    carrier_type?: string | null
    amount?: number | string | null
    issued_at?: string | null
    error_message?: string | null
  } | null
  /** Optional: lets the empty state explain why there's no row yet. */
  paymentStatus: string
  /** Base URL of the API server, used to deep-link to the PDF endpoint. */
  apiUrl: string
}

export function InvoiceCard({
  orderId,
  invoice,
  paymentStatus,
  apiUrl,
}: InvoiceCardProps) {
  const [isPending, startTransition] = useTransition()
  const [voidReason, setVoidReason] = useState("")
  const [showVoidForm, setShowVoidForm] = useState(false)

  // No invoice row yet — explain why instead of just hiding.
  if (!invoice) {
    return (
      <div className="rounded-lg border bg-white p-4 text-sm">
        <div className="mb-2 flex items-center gap-2 text-zinc-900">
          <FileText className="h-4 w-4" />
          <span className="font-medium">發票資訊</span>
        </div>
        <p className="text-zinc-400">
          {paymentStatus === "paid"
            ? "尚未建立發票（系統會在付款完成後自動排程開立，若超過 5 分鐘仍未出現請聯絡技術支援）"
            : "尚未建立發票（需付款完成後系統自動開立）"}
        </p>
      </div>
    )
  }

  function handleReissue() {
    startTransition(() => reissueInvoiceAction(orderId, invoice!.id))
  }

  function handleVoid() {
    if (!voidReason.trim()) return
    startTransition(async () => {
      await voidInvoiceAction(orderId, invoice!.id, voidReason.trim())
      setVoidReason("")
      setShowVoidForm(false)
    })
  }

  const canReissue =
    invoice.status === "pending" || invoice.status === "failed"
  const canVoid = invoice.status === "issued"
  const canViewPdf = invoice.status === "issued" && invoice.invoice_number

  return (
    <div className="rounded-lg border bg-white p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900">
          <FileText className="h-4 w-4" />
          <span className="font-medium">發票資訊</span>
        </div>
        <Badge variant={INVOICE_STATUS_VARIANT[invoice.status] ?? "outline"}>
          {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between">
          <span className="text-zinc-500">發票號碼</span>
          <span className="font-mono">{invoice.invoice_number ?? "—"}</span>
        </div>
        {invoice.amount != null && (
          <div className="flex justify-between">
            <span className="text-zinc-500">金額</span>
            <span>NT$ {Number(invoice.amount).toLocaleString()}</span>
          </div>
        )}
        {invoice.type && (
          <div className="flex justify-between">
            <span className="text-zinc-500">類型</span>
            <span>
              {invoice.type === "b2b"
                ? "B2B 三聯式"
                : invoice.type === "b2c"
                  ? "B2C 二聯式"
                  : invoice.type}
            </span>
          </div>
        )}
        {invoice.carrier_type && (
          <div className="flex justify-between">
            <span className="text-zinc-500">載具</span>
            <span>
              {invoice.carrier_type === "phone"
                ? "手機條碼"
                : invoice.carrier_type === "natural_person"
                  ? "自然人憑證"
                  : invoice.carrier_type === "love_code"
                    ? "愛心碼捐贈"
                    : invoice.carrier_type === "member"
                      ? "會員載具"
                      : invoice.carrier_type}
            </span>
          </div>
        )}
        {invoice.issued_at && (
          <div className="flex justify-between">
            <span className="text-zinc-500">開立時間</span>
            <span>
              {new Date(invoice.issued_at).toLocaleString("zh-TW")}
            </span>
          </div>
        )}
        {invoice.error_message && (
          <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
            錯誤訊息：{invoice.error_message}
          </div>
        )}
      </div>

      {/* Action row */}
      {(canReissue || canVoid || canViewPdf) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
          {canViewPdf && (
            <a
              href={`${apiUrl}/admin/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              查看 PDF
            </a>
          )}
          {canReissue && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={handleReissue}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重新開立
            </Button>
          )}
          {canVoid && !showVoidForm && (
            <Button
              size="sm"
              variant="destructive"
              disabled={isPending}
              onClick={() => setShowVoidForm(true)}
            >
              <Ban className="mr-1 h-3.5 w-3.5" />
              作廢
            </Button>
          )}
        </div>
      )}

      {/* Void confirmation form */}
      {showVoidForm && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50/50 p-3 space-y-2">
          <p className="text-xs text-red-700">
            作廢後將通知 Amego 並無法復原。請輸入作廢原因：
          </p>
          <input
            type="text"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="例：訂單取消 / 客戶要求"
            className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowVoidForm(false)
                setVoidReason("")
              }}
              disabled={isPending}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleVoid}
              disabled={isPending || !voidReason.trim()}
            >
              {isPending ? "處理中…" : "確認作廢"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Logistics Card ---------- */

const LOGISTICS_STATUS_LABEL: Record<string, string> = {
  pending: "建立中",
  in_transit: "已交寄",
  arrived_cvs: "已到店",
  delivered: "已取貨",
  failed: "失敗",
}

const LOGISTICS_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "outline",
  in_transit: "secondary",
  arrived_cvs: "default",
  delivered: "default",
  failed: "destructive",
}

const CVS_LABEL: Record<string, string> = {
  cvs_711: "7-11 取貨",
  cvs_family: "全家取貨",
  "7-11": "7-11 取貨",
  family: "全家取貨",
}

interface LogisticsRow {
  id: string
  provider: string | null
  type: string | null // "CVS" | "HOME"
  ecpay_logistics_id: string | null
  tracking_number: string | null
  cvs_payment_no: string | null
  cvs_validation_no: string | null
  status: string
  shipped_at: string | null
  delivered_at: string | null
  raw_response?: unknown
}

interface ShippingInfo {
  name: string | null
  phone: string | null
  address: string | null
  cvs_store_id: string | null
  cvs_type: string | null
  address_type: string | null
}

interface LogisticsCardProps {
  orderId: string
  logistics: LogisticsRow | null
  shipping: ShippingInfo | null
  paymentStatus: string
  shippingMethod: string | null
}

export function LogisticsCard({
  orderId,
  logistics,
  shipping,
  paymentStatus,
  shippingMethod,
}: LogisticsCardProps) {
  const [isPending, startTransition] = useTransition()
  const isCvs = shipping?.address_type === "cvs" || shippingMethod?.startsWith("cvs")
  const cvsLabel = CVS_LABEL[shippingMethod ?? ""] ?? (isCvs ? "超商取貨" : "宅配到府")

  function handleRetry() {
    startTransition(() => retryShipmentAction(orderId))
  }

  // Empty state — explain why + offer retry if payment is settled.
  if (!logistics) {
    return (
      <div className="rounded-lg border bg-white p-4 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-900">
            <Truck className="h-4 w-4" />
            <span className="font-medium">物流資訊</span>
          </div>
          {paymentStatus === "paid" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={handleRetry}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              {isPending ? "重派中…" : "重派物流"}
            </Button>
          )}
        </div>
        <p className="text-zinc-400">
          {paymentStatus === "paid"
            ? "尚未建立物流（系統應已自動派工；若超過 1 分鐘仍無資料請按右上「重派物流」）"
            : "尚未建立物流（需付款完成）"}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-white p-4 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900">
          <Truck className="h-4 w-4" />
          <span className="font-medium">物流資訊</span>
        </div>
        <Badge variant={LOGISTICS_STATUS_VARIANT[logistics.status] ?? "outline"}>
          {LOGISTICS_STATUS_LABEL[logistics.status] ?? logistics.status}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <Row label="物流商" value={logistics.provider === "ecpay" ? "綠界 (ECPay)" : logistics.provider ?? "—"} />
        <Row label="取貨方式" value={cvsLabel} />

        {isCvs && shipping && (
          <Row
            label="取貨門市"
            value={
              <span>
                {shipping.address ?? "—"}
                {shipping.cvs_store_id && (
                  <span className="ml-1 text-xs text-zinc-400">({shipping.cvs_store_id})</span>
                )}
              </span>
            }
          />
        )}
        {shipping && !isCvs && (
          <Row label="收件地址" value={shipping.address ?? "—"} />
        )}
        {shipping && (
          <Row
            label="收件人"
            value={
              <span>
                {shipping.name ?? "—"}
                {shipping.phone && (
                  <span className="ml-2 text-xs text-zinc-500">/ {shipping.phone}</span>
                )}
              </span>
            }
          />
        )}

        <div className="my-2 border-t border-dashed border-zinc-200" />

        <Row label="物流編號" value={<span className="font-mono text-xs">{logistics.ecpay_logistics_id ?? "—"}</span>} />

        {isCvs && (
          <>
            <CopyableRow
              label="超商寄件代碼"
              value={logistics.cvs_payment_no ?? ""}
              emptyText="—"
            />
            <CopyableRow
              label="超商驗證碼"
              value={logistics.cvs_validation_no ?? ""}
              emptyText="—"
            />
          </>
        )}

        {!isCvs && logistics.tracking_number && (
          <Row
            label="宅配追蹤號"
            value={<span className="font-mono text-xs">{logistics.tracking_number}</span>}
          />
        )}

        {logistics.shipped_at && (
          <Row
            label="已出貨"
            value={new Date(logistics.shipped_at).toLocaleString("zh-TW")}
          />
        )}
        {logistics.delivered_at && (
          <Row
            label="已送達"
            value={new Date(logistics.delivered_at).toLocaleString("zh-TW")}
          />
        )}
      </div>

      {(logistics.status === "failed" || logistics.status === "pending") && (
        <div className="mt-4 flex justify-end border-t pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={handleRetry}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            {isPending ? "重派中…" : "重派物流"}
          </Button>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right text-zinc-900">{value}</span>
    </div>
  )
}

function CopyableRow({
  label,
  value,
  emptyText,
}: {
  label: string
  value: string
  emptyText: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(`${label}已複製`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("複製失敗")
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`font-mono text-xs ${value ? "text-zinc-900" : "text-zinc-400"}`}>
          {value || emptyText}
        </span>
        {value && (
          <button
            type="button"
            onClick={handleCopy}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label={`複製${label}`}
          >
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
    </div>
  )
}
