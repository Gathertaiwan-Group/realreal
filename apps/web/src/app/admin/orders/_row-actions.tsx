"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import {
  deleteOrderAction,
  restoreOrderAction,
  reissueAllInvoicesAction,
  retryPostPaymentBatchAction,
  shipBatchAction,
  voidLegacyDuplicateInvoicesAction,
} from "./[id]/actions"

// 封存 (soft-archive) for an ACTIVE order in the list. Reversible: the order
// moves to the 「顯示已封存」 view where it can be 還原 (restored) or 永久刪除
// (hard-purged, guarded for paid/invoiced). Inline two-step confirm so a stray
// click can't drop an order. Mirrors the detail page's 刪除訂單 default.
export function ArchiveRowAction({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function handleArchive() {
    startTransition(async () => {
      const result = await deleteOrderAction(orderId, { hard: false })
      if (result.ok) {
        toast.success("訂單已封存（可還原）")
        router.refresh()
      } else {
        toast.error(result.error ?? "封存失敗")
        setConfirm(false)
      }
    })
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="text-amber-600 hover:underline text-xs font-medium"
      >
        封存
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleArchive}
        disabled={isPending}
        className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
      >
        {isPending ? "封存中…" : "確認封存"}
      </button>
      <button
        type="button"
        onClick={() => setConfirm(false)}
        disabled={isPending}
        className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
      >
        取消
      </button>
    </span>
  )
}

// Row-level controls for an archived order in the list. The table is
// server-rendered, so this minimal client island handles the 還原 (restore)
// and 永久刪除 (hard purge) interactions and calls router.refresh() to re-pull
// the (filtered) list after the row's state changes.
export function ArchivedRowActions({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmPurge, setConfirmPurge] = useState(false)

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreOrderAction(orderId)
      if (result.ok) {
        toast.success("訂單已還原")
        router.refresh()
      } else {
        toast.error(result.error ?? "還原失敗")
      }
    })
  }

  function handlePurge() {
    startTransition(async () => {
      const result = await deleteOrderAction(orderId, { hard: true })
      if (result.ok) {
        toast.success("訂單已永久刪除")
        router.refresh()
      } else {
        // e.g. the 409 for paid / invoiced orders — keep the row, explain why.
        toast.error(result.error ?? "永久刪除失敗")
        setConfirmPurge(false)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        className="rounded-[10px] text-xs"
        disabled={isPending}
        onClick={handleRestore}
      >
        還原
      </Button>
      {!confirmPurge ? (
        <button
          type="button"
          onClick={() => setConfirmPurge(true)}
          disabled={isPending}
          aria-label="永久刪除"
          title="永久刪除（僅限未付款）"
          className="rounded p-1.5 text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : (
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePurge}
            disabled={isPending}
            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {isPending ? "刪除中…" : "確認刪除"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmPurge(false)}
            disabled={isPending}
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50"
          >
            取消
          </button>
        </span>
      )}
    </div>
  )
}

/**
 * 整批補開發票。
 *
 * 字軌用完時整個 backlog 會一起失敗（2026-08-20 那次卡了 45 筆、11 天），
 * 一筆一筆按不是可行的復原方式。兩段式確認，因為這會真的送出發票。
 * WP 舊站訂單由 API 端預設排除 —— 那些在匯入前就已經開過發票了。
 */
export function ReissueAllInvoicesAction() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function handleReissue() {
    startTransition(async () => {
      const result = await reissueAllInvoicesAction()
      if (result.ok) {
        const skipped = result.skippedLegacy
          ? `，已跳過 ${result.skippedLegacy} 筆舊站訂單`
          : ""
        toast.success(`已送出 ${result.enqueued ?? 0} 筆發票補開${skipped}`, {
          description: "開立需要一點時間，稍後重新整理查看結果。",
        })
        router.refresh()
      } else {
        toast.error(result.error ?? "批次補開失敗")
      }
      setConfirm(false)
    })
  }

  if (!confirm) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
        補開所有未開發票
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-600">確定送出？</span>
      <Button size="sm" onClick={handleReissue} disabled={isPending}>
        {isPending ? "送出中…" : "確定"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm(false)} disabled={isPending}>
        取消
      </Button>
    </div>
  )
}

/**
 * 補算所有漏掉的消費金額／點數／會員等級。
 *
 * 手動出貨的超商取貨付款訂單長期停在待付款，付款後流程從沒跑過，客人的消費
 * 與點數都沒算到（2026-08-31 有 14 筆會員訂單）。只處理「已付款且從未計算過」
 * 的訂單，底層每個步驟都是冪等的，重複按不會重複計算。
 */
export function RetryPostPaymentBatchAction() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function handleRun() {
    startTransition(async () => {
      const result = await retryPostPaymentBatchAction()
      if (result.ok) {
        const skipped = result.skippedAlreadyDone
          ? `，${result.skippedAlreadyDone} 筆已計算過略過`
          : ""
        toast.success(`已補算 ${result.processed ?? 0} 筆訂單${skipped}`, {
          description: "消費金額、點數與會員等級已更新。",
        })
        router.refresh()
      } else {
        toast.error(result.error ?? "補算失敗")
      }
      setConfirm(false)
    })
  }

  if (!confirm) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
        補算消費與點數
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-600">確定執行？</span>
      <Button size="sm" onClick={handleRun} disabled={isPending}>
        {isPending ? "執行中…" : "確定"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm(false)} disabled={isPending}>
        取消
      </Button>
    </div>
  )
}

/**
 * 批次出貨：貼上訂單編號 → 一次標記出貨並寄通知信。
 *
 * 為什麼是「貼清單」而不是「勾選全部處理中」：出貨當天真正出的那批，跟後台當下
 * 篩得出來的那批從來不會剛好一樣（有人改地址、有人待補款、有廠商代出的先出）。
 * 揀貨清單是從出貨單來的，貼進來的就是實際裝箱的那幾筆 —— 送出前螢幕上看得到
 * 完整名單與筆數，按下去不會多出一筆沒人預期的訂單。
 */
export function ShipBatchAction() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState("")

  // 逗號、空白、換行都當分隔；重複的只算一次。
  const orderNumbers = Array.from(
    new Set((raw.match(/[A-Za-z0-9]+/g) ?? []).map((n) => n.trim()).filter(Boolean)),
  )

  function handleShip() {
    startTransition(async () => {
      const result = await shipBatchAction(orderNumbers)
      if (!result.ok) {
        toast.error(result.error ?? "批次出貨失敗")
        return
      }
      const shipped = result.shipped ?? []
      const skipped = result.skipped ?? []
      if (shipped.length > 0) {
        toast.success(`已出貨 ${shipped.length} 筆，通知信已寄出`, {
          description:
            skipped.length > 0
              ? `${skipped.length} 筆未處理：${skipped.map((x) => `${x.orderNumber}（${x.reason}）`).join("、")}`
              : undefined,
          duration: skipped.length > 0 ? 20000 : 5000,
        })
      } else {
        toast.error("沒有任何訂單被出貨", {
          description: skipped.map((x) => `${x.orderNumber}（${x.reason}）`).join("、"),
          duration: 20000,
        })
      }
      setRaw("")
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        批次出貨
      </Button>
    )
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
        批次出貨
      </Button>
      <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-lg border bg-white p-3 shadow-lg">
        <p className="mb-1 text-xs font-medium text-[#10305a]">批次標記出貨</p>
        <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
          貼上要出貨的訂單編號，一行一筆或用逗號分隔。每筆都會寄出貨通知信給客人。
        </p>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          autoFocus
          placeholder="10000150, 10000159, 10000161"
          className="w-full rounded border border-zinc-200 p-2 font-mono text-xs focus:border-[#10305a] focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-600">
            {orderNumbers.length > 0 ? `共 ${orderNumbers.length} 筆` : "尚未輸入"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false)
                setRaw("")
              }}
              disabled={isPending}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleShip} disabled={isPending || orderNumbers.length === 0}>
              {isPending ? "出貨中…" : `確定出貨 ${orderNumbers.length} 筆`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 作廢 WP 舊站訂單被重複開立的發票。
 *
 * 只找得到「狀態為已開立、且訂單編號以 WP 開頭」的發票，指不到任何新站訂單。
 * 已作廢的會自動略過，所以重複按不會再送一次作廢。
 */
export function VoidLegacyDuplicatesAction() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function handleVoid() {
    startTransition(async () => {
      const result = await voidLegacyDuplicateInvoicesAction()
      if (!result.ok) {
        toast.error(result.error ?? "作廢失敗")
        setConfirm(false)
        return
      }
      const voided = result.voided ?? []
      const failed = result.failed ?? []
      const total = voided.reduce((sum, v) => sum + Number(v.amount ?? 0), 0)
      if (voided.length > 0) {
        toast.success(`已作廢 ${voided.length} 張發票（NT$ ${total.toLocaleString()}）`, {
          description: voided.map((v) => `${v.orderNumber} ${v.invoiceNumber}`).join("、"),
          duration: 20000,
        })
      } else if (failed.length === 0) {
        toast.info("沒有需要作廢的舊站發票")
      }
      if (failed.length > 0) {
        toast.error(`${failed.length} 張作廢失敗`, {
          description: failed.map((f) => `${f.invoiceNumber}：${f.error}`).join("、"),
          duration: 30000,
        })
      }
      setConfirm(false)
      router.refresh()
    })
  }

  if (!confirm) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
        作廢舊站重複發票
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-zinc-600">作廢後無法復原，確定？</span>
      <Button size="sm" onClick={handleVoid} disabled={isPending}>
        {isPending ? "作廢中…" : "確定"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm(false)} disabled={isPending}>
        取消
      </Button>
    </div>
  )
}
