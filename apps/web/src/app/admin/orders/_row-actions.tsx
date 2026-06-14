"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Trash2 } from "lucide-react"
import { deleteOrderAction, restoreOrderAction } from "./[id]/actions"

// 刪除 (soft-archive) for an ACTIVE order in the list. Soft-archive is the safe,
// reversible default — the order moves to the 「顯示已封存」 view where it can be
// 還原 (restored) or 永久刪除 (hard-purged, guarded for paid/invoiced). Inline
// two-step confirm so a stray click can't drop an order. Mirrors the detail
// page's 刪除訂單 default.
export function DeleteRowAction({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState(false)

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteOrderAction(orderId, { hard: false })
      if (result.ok) {
        toast.success("訂單已刪除（移至已封存，可還原）")
        router.refresh()
      } else {
        toast.error(result.error ?? "刪除失敗")
        setConfirm(false)
      }
    })
  }

  if (!confirm) {
    return (
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="text-red-600 hover:underline text-xs font-medium"
      >
        刪除
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleDelete}
        disabled={isPending}
        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? "刪除中…" : "確認刪除"}
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
