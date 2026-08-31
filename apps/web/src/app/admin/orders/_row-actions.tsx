"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { deleteOrderAction, restoreOrderAction, reissueAllInvoicesAction, retryPostPaymentBatchAction } from "./[id]/actions"

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
