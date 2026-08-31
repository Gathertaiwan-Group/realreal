"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  FileText,
  RefreshCw,
  Ban,
  Truck,
  Copy,
  Check,
  X,
  CheckCircle2,
  XCircle,
  Archive,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import {
  cancelOrderAction,
  confirmPaymentAction,
  deleteOrderAction,
  reissueInvoiceAction,
  retryPostPaymentAction,
  retryShipmentAction,
  shipOrderAction,
  updateOrderStatusAction,
  voidInvoiceAction,
} from "./actions"
import { getOrderDisplayStatus } from "@/lib/order-display-status"
import { createClient } from "@/lib/supabase/client"
import { API_URL } from "@/lib/api-url"

/* ---------- Action Buttons ---------- */

const CANCELLABLE_STATUSES = ["pending", "processing", "shipped"]

interface CancelActionResult {
  ok: boolean | null
  message: string
}

interface CancelResponse {
  ok?: boolean
  actions?: {
    invoice_void?: CancelActionResult
    logistics_cancel?: CancelActionResult
    payment_refund?: CancelActionResult
    points_refund?: CancelActionResult
    status_update?: CancelActionResult
  }
  error?: string
}

const CANCEL_STEP_LABELS: Record<string, string> = {
  invoice_void: "發票作廢",
  logistics_cancel: "綠界物流取消",
  payment_refund: "退款",
  points_refund: "點數退還",
  status_update: "訂單狀態",
}

interface OrderActionsProps {
  orderId: string
  status: string
  paymentStatus: string
  paymentMethod?: string | null
  logistics?: { status: string; type: string } | null
}

export function OrderActions({
  orderId,
  status,
  paymentStatus,
  paymentMethod,
  logistics: _logistics,
}: OrderActionsProps) {
  // logistics is accepted so page.tsx can pass it for parity with the
  // other components; OrderActions itself only branches on order.status.
  void _logistics
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState("")
  const [cancelResult, setCancelResult] = useState<CancelResponse | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  function handleAction(newStatus: string) {
    startTransition(async () => {
      const result = await updateOrderStatusAction(orderId, newStatus)
      if (result?.error) {
        toast.error(`狀態更新失敗：${result.error}`)
      } else {
        toast.success("訂單狀態已更新")
      }
    })
  }

  function handleConfirmCancel() {
    const reason = cancelReason.trim()
    if (!reason) return
    startTransition(async () => {
      try {
        const data = (await cancelOrderAction(orderId, reason)) as CancelResponse
        if (data?.error) {
          // Structured error from the server action (real message, unmasked).
          toast.error(data.error)
          setCancelResult({ ok: false, error: data.error })
          return
        }
        setCancelResult(data)
        if (data?.actions?.status_update?.ok) {
          toast.success("訂單已標記取消")
        }
      } catch (e) {
        // Belt-and-braces: actions return errors now, but keep the masked-throw
        // fallback in case something outside the action layer blows up.
        const msg = e instanceof Error ? e.message : "取消訂單失敗"
        toast.error(msg)
        setCancelResult({ ok: false, error: msg })
      }
    })
  }

  function closeModal() {
    if (isPending) return
    setShowCancelModal(false)
    setCancelReason("")
    setCancelResult(null)
  }

  // Soft archive (hard=false) or permanent purge (hard=true). On success the
  // order is gone/hidden from the active list, so we leave the detail page.
  // On error (e.g. the 409 for paid/invoiced orders) we keep the modal open
  // and toast the server's clean message.
  function handleDelete(hard: boolean) {
    startTransition(async () => {
      const result = await deleteOrderAction(orderId, { hard })
      if (result.ok) {
        toast.success(hard ? "訂單已永久刪除" : "訂單已封存")
        setShowDeleteModal(false)
        router.push("/admin/orders")
      } else {
        toast.error(result.error ?? "刪除訂單失敗")
      }
    })
  }

  function closeDeleteModal() {
    if (isPending) return
    setShowDeleteModal(false)
  }

  // 也對「誤標失敗」的訂單顯示 —— 讓 admin 能把「其實已收款卻被標成 failed」的單
  // 救回（確認付款 → 設 paid + 補跑付款後流程：點數/發票/物流/通知）。
  // 一般（線上付款）訂單：付款發生在出貨前，所以確認付款＝把狀態推進到 processing。
  const showConfirmPayment =
    (status === "pending" || status === "failed") && paymentStatus !== "paid" && paymentMethod !== "cvs_cod"
  // 超商取貨付款：款項是客人到店取貨時才收，此時訂單已經是 shipped/completed，
  // 不能用狀態轉換來確認付款（會把訂單倒退）。手動出貨的 COD 收不到綠界的取貨
  // 回報，沒有這顆按鈕就永遠停在待付款、不會開發票 —— 2026-08-31 一次累積了 25 筆。
  const showConfirmCodPayment =
    paymentMethod === "cvs_cod" &&
    paymentStatus !== "paid" &&
    (status === "shipped" || status === "completed")
  const showShip = status === "processing" || (status === "pending" && paymentMethod === "cvs_cod")
  // 「補跑付款後流程」recovery — for orders that ARE paid but whose post-payment
  // pipeline never completed (no 通知/發票/點數), e.g. manually confirmed before
  // the confirm→enqueue fix, or a transient enqueue failure. Jobs are idempotent
  // (完成的步驟自動略過); only the customer 付款確認信 re-sends, hence the confirm.
  const showRetryPostPayment = paymentStatus === "paid"
  // Spec section 2: 「完成訂單」manual fallback only when shipped.
  const showComplete = status === "shipped"
  // Spec section 3: cancellation only allowed in pending / processing / shipped.
  const showCancel = CANCELLABLE_STATUSES.includes(status)

  // The 「刪除訂單」(archive / permanent delete) control is always available,
  // so this component no longer short-circuits to null when there are no
  // status-based actions.

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {showConfirmPayment && (
          <Button size="sm" disabled={isPending} onClick={() => handleAction("processing")}>
            確認付款
          </Button>
        )}
        {showConfirmCodPayment && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              if (!confirm("確認客人已到超商取貨並付款？會標記為已付款，並開立發票、累積消費與點數，同時寄出付款確認信給客人。")) return
              startTransition(async () => {
                const result = await confirmPaymentAction(orderId)
                if (result.ok) {
                  toast.success("已確認收款（發票／點數／通知信已送出）")
                  router.refresh()
                } else {
                  toast.error(`確認付款失敗：${result.error}`)
                }
              })
            }}
          >
            確認取貨付款
          </Button>
        )}
        {showShip && (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const result = await shipOrderAction(orderId)
                if (result?.error) {
                  toast.error(`出貨失敗：${result.error}`)
                } else {
                  toast.success("訂單已出貨，通知信已寄出")
                }
              })
            }}
          >
            出貨
          </Button>
        )}
        {showComplete && (
          <Button size="sm" variant="secondary" disabled={isPending} onClick={() => handleAction("completed")}>
            完成訂單
          </Button>
        )}
        {showRetryPostPayment && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              if (
                !window.confirm(
                  "補跑付款後流程？\n\n會重寄「付款確認信」給客人，並補開發票、補發點數/升等（皆為冪等，已完成的步驟自動略過）。\n\n用於「已付款但沒收到通知/沒開發票」的訂單。",
                )
              )
                return
              startTransition(async () => {
                const result = await retryPostPaymentAction(orderId)
                if (result?.error) {
                  toast.error(`補跑失敗：${result.error}`)
                } else {
                  toast.success("已補跑付款後流程（通知／發票／點數／升等）")
                }
              })
            }}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" />
            補跑付款後流程
          </Button>
        )}
        {showCancel && (
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              setCancelResult(null)
              setCancelReason("")
              setShowCancelModal(true)
            }}
          >
            取消訂單
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => setShowDeleteModal(true)}
        >
          <Archive className="mr-1 h-3.5 w-3.5" />
          刪除訂單
        </Button>
      </div>

      {showCancelModal && (
        <CancelOrderModal
          isPending={isPending}
          reason={cancelReason}
          onReasonChange={setCancelReason}
          result={cancelResult}
          onConfirm={handleConfirmCancel}
          onClose={closeModal}
        />
      )}

      {showDeleteModal && (
        <DeleteOrderModal
          isPending={isPending}
          onArchive={() => handleDelete(false)}
          onHardDelete={() => handleDelete(true)}
          onClose={closeDeleteModal}
        />
      )}
    </>
  )
}

/* ---------- Delete Order Modal ---------- */

interface DeleteOrderModalProps {
  isPending: boolean
  onArchive: () => void
  onHardDelete: () => void
  onClose: () => void
}

// Offers two destructive paths with very different blast radius:
//   封存 (archive)  — the safe default: hides the order from the active list
//                     but keeps the row, fully reversible via 還原.
//   永久刪除 (hard)  — irreversible, and the API only permits it for unpaid /
//                     un-invoiced orders (otherwise it 409s and we keep the
//                     modal open with the server's explanation toasted).
// 封存 is styled as the primary CTA; 永久刪除 is a low-emphasis destructive
// link guarded behind a second confirm so it can't be fat-fingered.
function DeleteOrderModal({
  isPending,
  onArchive,
  onHardDelete,
  onClose,
}: DeleteOrderModalProps) {
  const [confirmHard, setConfirmHard] = useState(false)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-order-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="delete-order-title" className="text-sm font-semibold">
            刪除訂單
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="關閉"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-sm text-zinc-600">請選擇處理方式：</p>

          {/* 封存 — safe default */}
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-900">
              <Archive className="h-4 w-4" />
              封存
            </div>
            <p className="text-xs text-zinc-500">
              從列表隱藏，可還原
            </p>
          </div>

          {/* 永久刪除 — destructive, explained */}
          <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-red-700">
              <Trash2 className="h-4 w-4" />
              永久刪除
            </div>
            <p className="text-xs text-red-600">
              僅限未付款訂單，無法復原
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t px-4 py-3">
          {!confirmHard ? (
            <>
              <Button
                size="sm"
                onClick={onArchive}
                disabled={isPending}
              >
                <Archive className="mr-1 h-3.5 w-3.5" />
                {isPending ? "處理中…" : "封存（建議）"}
              </Button>
              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  disabled={isPending}
                >
                  取消
                </Button>
                <button
                  type="button"
                  onClick={() => setConfirmHard(true)}
                  disabled={isPending}
                  className="text-xs font-medium text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
                >
                  改為永久刪除
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-red-700">
                確定要永久刪除此訂單？此動作無法復原。
              </p>
              <Button
                size="sm"
                variant="destructive"
                onClick={onHardDelete}
                disabled={isPending}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {isPending ? "刪除中…" : "確認永久刪除"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmHard(false)}
                disabled={isPending}
              >
                返回
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Cancel Order Modal ---------- */

interface CancelOrderModalProps {
  isPending: boolean
  reason: string
  onReasonChange: (v: string) => void
  result: CancelResponse | null
  onConfirm: () => void
  onClose: () => void
}

function CancelOrderModal({
  isPending,
  reason,
  onReasonChange,
  result,
  onConfirm,
  onClose,
}: CancelOrderModalProps) {
  const remaining = 200 - reason.length
  const hasResult = result !== null
  const actions = result?.actions ?? null
  // Render the steps in a stable order with friendly labels.
  const stepKeys = [
    "invoice_void",
    "logistics_cancel",
    "payment_refund",
    "points_refund",
    "status_update",
  ] as const

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-order-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id="cancel-order-title" className="text-sm font-semibold">
            取消訂單
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="關閉"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {!hasResult && (
            <>
              <p className="text-sm text-zinc-600">
                取消訂單會嘗試作廢發票、取消綠界物流、退款，並翻訂單狀態。請輸入取消原因：
              </p>
              <div>
                <textarea
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value.slice(0, 200))}
                  placeholder="例：客戶要求取消 / 缺貨 / 重複下單"
                  maxLength={200}
                  rows={3}
                  className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
                  autoFocus
                  disabled={isPending}
                />
                <p className="mt-1 text-xs text-zinc-400">
                  剩餘 {remaining} 字
                </p>
              </div>
            </>
          )}

          {hasResult && result?.error && !actions && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {result.error}
            </div>
          )}

          {hasResult && actions && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-zinc-900">取消結果</p>
              <ul className="space-y-1.5">
                {stepKeys.map((k) => {
                  const step = actions[k]
                  if (!step) return null
                  const isOk = step.ok === true
                  return (
                    <li
                      key={k}
                      className={`flex items-start gap-2 rounded-md p-2 text-xs ${
                        isOk
                          ? "bg-green-50 text-green-800"
                          : "bg-red-50 text-red-800"
                      }`}
                    >
                      {isOk ? (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{CANCEL_STEP_LABELS[k]}</div>
                        <div className="text-xs opacity-90">{step.message}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          {!hasResult ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={onClose}
                disabled={isPending}
              >
                返回
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={onConfirm}
                disabled={isPending || !reason.trim()}
              >
                {isPending ? "處理中…" : "確認取消"}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={onClose} disabled={isPending}>
              關閉
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- Order Timeline ---------- */

// Two timeline variants per spec section 1:
//   HOME: 建單 → 已派工 → 運送中 → 已配達 (4 steps)
//   CVS:  建單 → 已派工 → 運送中 → 已到店待取 → 已取貨 (5 steps)
// Each step's `keys` is the set of getOrderDisplayStatus keys at or past
// that point. The active step is the highest-index step whose keys
// contain the current display status.
type TimelineStep = {
  label: string
  // display status keys that mean "this step is the active one"
  matches: string[]
}

const HOME_TIMELINE: TimelineStep[] = [
  { label: "建單", matches: ["awaiting_payment", "awaiting_shipment"] },
  { label: "已派工", matches: ["dispatched"] },
  { label: "運送中", matches: ["in_transit"] },
  { label: "已配達", matches: ["delivered"] },
]

const CVS_TIMELINE: TimelineStep[] = [
  { label: "建單", matches: ["awaiting_payment", "awaiting_shipment"] },
  { label: "已派工", matches: ["dispatched"] },
  { label: "運送中", matches: ["in_transit"] },
  { label: "已到店待取", matches: ["arrived_cvs"] },
  { label: "已取貨", matches: ["picked_up"] },
]

interface OrderTimelineProps {
  status: string
  createdAt: string
  logistics?: { status: string; type: string } | null
}

export function OrderTimeline({ status, createdAt, logistics }: OrderTimelineProps) {
  void createdAt
  const display = getOrderDisplayStatus({ status }, logistics ?? null)

  // Collapsed banner for cancelled / failed / returned-unclaimed:
  // the multi-step bar isn't meaningful, so collapse to a single
  // red call-out per spec section 1.
  const isTerminalBad =
    display.key === "cancelled" ||
    display.key === "failed" ||
    display.key === "returned_unclaimed"

  if (isTerminalBad) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">
          ✕
        </span>
        <span className="font-medium">{display.label}</span>
      </div>
    )
  }

  // Pick timeline shape from logistics.type. Default to HOME when
  // unknown so we don't show a phantom 5th "CVS 取貨" step on宅配 orders.
  const steps = logistics?.type === "CVS" ? CVS_TIMELINE : HOME_TIMELINE

  // Highest-index step whose `matches` array contains the display key.
  // If none matches (e.g. very early state with no logistics row yet)
  // we land on step 0 ("建單") which is the correct default.
  let activeIndex = steps.findIndex((s) => s.matches.includes(display.key))
  if (activeIndex < 0) activeIndex = 0

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto py-2">
      {steps.map((step, i) => {
        const isReached = i <= activeIndex
        const isCurrent = i === activeIndex
        return (
          <div key={step.label} className="flex items-center flex-1 min-w-0">
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
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 ${
                  i < activeIndex ? "bg-zinc-900" : "bg-zinc-200"
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- Invoice Card ---------- */

const INVOICE_STATUS_LABEL: Record<string, string> = {
  pending: "待開立",
  // 'issuing' 是 migration 0049 加的中間狀態：已經向 Amego 送出、還沒收到／還沒記錄
  // 結果。它存在的目的就是讓這段空窗在系統裡看得見，所以它必須在 UI 上有名字。
  issuing: "開立中",
  issued: "已開立",
  voided: "已作廢",
  failed: "開立失敗",
}

const INVOICE_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "outline",
  issuing: "secondary",
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
}

export function InvoiceCard({
  orderId,
  invoice,
  paymentStatus,
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
    startTransition(async () => {
      const result = await reissueInvoiceAction(orderId, invoice!.id)
      if (result?.error) toast.error(`重開發票失敗：${result.error}`)
      else toast.success("已重新排程開立發票")
    })
  }

  function handleVoid() {
    if (!voidReason.trim()) return
    startTransition(async () => {
      const result = await voidInvoiceAction(orderId, invoice!.id, voidReason.trim())
      if (result?.error) {
        toast.error(`發票作廢失敗：${result.error}`)
        return
      }
      toast.success("發票已作廢")
      setVoidReason("")
      setShowVoidForm(false)
    })
  }

  // 'issuing' 也要能按補開。卡在 issuing 的列是「行程死在開票途中」留下的，正是最需要
  // 人工推一把的那一種；把按鈕藏起來等於讓它從後台消失。重複按是安全的——真正的
  // 防重複在 DB 的 claim_invoice_issue，而不是這個按鈕的可見性。
  const canReissue =
    invoice.status === "pending" || invoice.status === "failed" || invoice.status === "issuing"
  const canVoid = invoice.status === "issued"

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
        {/* error_message belongs to FAILED attempts only — for issued/voided
            rows it's almost always stale (leftover from a pre-success
            retry) so hide it. */}
        {invoice.error_message &&
          invoice.status !== "issued" &&
          invoice.status !== "voided" && (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-700">
              錯誤訊息：{invoice.error_message}
            </div>
          )}
      </div>

      {/* Action row */}
      {(canReissue || canVoid) && (
        <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
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
  paymentMethod: string | null
  shippingMethod: string | null
}

export function LogisticsCard({
  orderId,
  logistics,
  shipping,
  paymentStatus,
  paymentMethod,
  shippingMethod,
}: LogisticsCardProps) {
  const [isPending, startTransition] = useTransition()
  const isCvs = shipping?.address_type === "cvs" || shippingMethod?.startsWith("cvs")
  const cvsLabel = CVS_LABEL[shippingMethod ?? ""] ?? (isCvs ? "超商取貨" : "宅配到府")

  function handleRetry() {
    startTransition(async () => {
      const result = await retryShipmentAction(orderId)
      if (result?.error) toast.error(`重建物流失敗：${result.error}`)
      else toast.success("已重新建立物流")
    })
  }

  // Open ECPay's C2C 寄件單 print page. The endpoint needs admin auth, so we
  // fetch it with the session token and write the auto-submitting HTML into a
  // new window (a plain link couldn't carry the Authorization header).
  const [printing, setPrinting] = useState(false)
  async function handlePrintLabel() {
    setPrinting(true)
    const win = window.open("", "_blank")
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/logistics/print/${orderId}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      })
      const html = await res.text()
      if (!res.ok) {
        win?.close()
        toast.error(`列印失敗：${html || res.statusText}`)
        return
      }
      win?.document.write(html)
      win?.document.close()
    } catch (e) {
      win?.close()
      toast.error(e instanceof Error ? e.message : "列印失敗")
    } finally {
      setPrinting(false)
    }
  }

  // Empty state — explain why + offer retry.
  // 超商取貨付款 (cvs_cod) builds logistics at order time, NOT after payment, so
  // its payment_status stays "pending" until pickup. For COD we must still offer
  // retry and must NOT show the misleading "需付款完成" copy. No row here means
  // the ECPay 建單 failed — retrying surfaces the real reason in the 失敗 box.
  if (!logistics) {
    const isCod = paymentMethod === "cvs_cod"
    const canRetry = paymentStatus === "paid" || isCod
    return (
      <div className="rounded-lg border bg-white p-4 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-900">
            <Truck className="h-4 w-4" />
            <span className="font-medium">物流資訊</span>
          </div>
          {canRetry && (
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
          {isCod
            ? "尚未建立物流。超商取貨付款於下單時即自動建立綠界物流，無需等待付款；此處無資料代表建單失敗，請按右上「重派物流」重試（失敗原因會顯示在這裡）。"
            : paymentStatus === "paid"
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
        <div className="flex items-center gap-2">
          {logistics.status === "failed" && (
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
          <Badge variant={LOGISTICS_STATUS_VARIANT[logistics.status] ?? "outline"}>
            {LOGISTICS_STATUS_LABEL[logistics.status] ?? logistics.status}
          </Badge>
        </div>
      </div>

      {logistics.status === "failed" && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <p className="mb-1 font-medium">綠界物流建立失敗</p>
          <p className="break-all font-mono">
            {(logistics.raw_response as { error?: string } | null)?.error ??
              "未知錯誤（請查伺服器日誌）"}
          </p>
          <p className="mt-1.5 text-red-500">修正綠界設定後，按右上「重派物流」重試。</p>
        </div>
      )}

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
            {logistics.cvs_payment_no && (
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={printing}
                  onClick={handlePrintLabel}
                >
                  {printing ? "開啟中…" : "🖨 列印寄件單"}
                </Button>
              </div>
            )}
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
