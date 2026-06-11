"use client"
import { useMemo, useState } from "react"
import Link from "next/link"
import { Star, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"

type Row = {
  id: string
  name: string
  slug: string
  is_active: boolean
  is_featured?: boolean
  is_addon?: boolean
  display_priority?: number
  created_at: string
  deleted_at?: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

async function getToken(): Promise<string> {
  const supabase = createClient()
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? ""
}

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const fa = a.is_featured ? 1 : 0
    const fb = b.is_featured ? 1 : 0
    if (fa !== fb) return fb - fa
    const pa = a.display_priority ?? 0
    const pb = b.display_priority ?? 0
    if (pa !== pb) return pb - pa
    return (b.created_at ?? "").localeCompare(a.created_at ?? "")
  })
}

export default function AdminProductsClient({
  initialProducts,
  archived,
}: {
  initialProducts: Row[]
  archived: boolean
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialProducts.map(p => ({
      ...p,
      is_featured: p.is_featured ?? false,
      display_priority: p.display_priority ?? 0,
    })),
  )
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The product currently targeted by the delete confirm modal (active view only).
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null)
  // Inline 409 / failure message shown inside the modal so the row is kept visible.
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalBusy, setModalBusy] = useState(false)

  const sorted = useMemo(() => sortRows(rows), [rows])

  async function patchFeature(id: string, body: { is_featured?: boolean; display_priority?: number }) {
    const prev = rows
    // optimistic update
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...body } : r)))
    setPendingId(id)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/products/${id}/feature`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setError(`更新失敗 (${res.status})：${JSON.stringify(errData)}`)
        setRows(prev) // rollback
        return
      }
      const json = await res.json().catch(() => null)
      const updated = json?.data ?? json
      if (updated && typeof updated === "object" && updated.id) {
        setRows(rs =>
          rs.map(r =>
            r.id === id
              ? {
                  ...r,
                  is_featured: updated.is_featured ?? r.is_featured,
                  display_priority: updated.display_priority ?? r.display_priority,
                }
              : r,
          ),
        )
      }
    } catch (err) {
      setError(`網路錯誤：${err instanceof Error ? err.message : String(err)}`)
      setRows(prev)
    } finally {
      setPendingId(null)
    }
  }

  function clampPriority(n: number): number {
    if (!Number.isFinite(n)) return 0
    if (n < 0) return 0
    if (n > 9999) return 9999
    return Math.floor(n)
  }

  function removeRow(id: string) {
    setRows(rs => rs.filter(r => r.id !== id))
  }

  function openDeleteModal(row: Row) {
    setDeleteTarget(row)
    setModalError(null)
  }

  function closeDeleteModal() {
    if (modalBusy) return
    setDeleteTarget(null)
    setModalError(null)
  }

  // 封存 (soft delete): DELETE /products/:id — always succeeds, row leaves the active list.
  async function archiveProduct(row: Row) {
    setModalBusy(true)
    setModalError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/products/${row.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setModalError(errData?.error ?? `封存失敗 (${res.status})`)
        return
      }
      removeRow(row.id)
      setDeleteTarget(null)
      toast.success("已封存")
    } catch (err) {
      setModalError(`網路錯誤：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setModalBusy(false)
    }
  }

  // 永久刪除 (hard delete): DELETE /products/:id?hard=true.
  // 409 = referenced by orders/plans → keep the row and surface the server message.
  async function hardDeleteProduct(row: Row) {
    setModalBusy(true)
    setModalError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/products/${row.id}?hard=true`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.status === 409) {
        const errData = await res.json().catch(() => ({}))
        setModalError(errData?.error ?? "此商品有歷史訂單或訂閱方案引用，無法永久刪除，請改用封存")
        return
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setModalError(errData?.error ?? `永久刪除失敗 (${res.status})`)
        return
      }
      removeRow(row.id)
      setDeleteTarget(null)
      toast.success("已永久刪除")
    } catch (err) {
      setModalError(`網路錯誤：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setModalBusy(false)
    }
  }

  // 還原 (restore): POST /admin/products/:id/restore — clears deleted_at, returns as 下架.
  async function restoreProduct(id: string) {
    setPendingId(id)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API_URL}/admin/products/${id}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        const msg = errData?.error ?? `還原失敗 (${res.status})`
        setError(msg)
        toast.error(msg)
        return
      }
      removeRow(id)
      toast.success("已還原（會以下架狀態返回）")
    } catch (err) {
      const msg = `網路錯誤：${err instanceof Error ? err.message : String(err)}`
      setError(msg)
      toast.error(msg)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          {archived ? "顯示已封存的商品" : "顯示上架中的商品"}
        </p>
        {archived ? (
          <Link href="/admin/products">
            <Button variant="outline" size="sm">顯示上架中</Button>
          </Link>
        ) : (
          <Link href="/admin/products?archived=1">
            <Button variant="outline" size="sm">顯示已封存</Button>
          </Link>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="border rounded-lg divide-y">
        {sorted.length === 0 && (
          <p className="p-4 text-zinc-500">{archived ? "尚無已封存商品" : "尚無商品"}</p>
        )}
        {sorted.map(p => {
          const isFeatured = !!p.is_featured
          const isPending = pendingId === p.id
          return (
            <div key={p.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{p.name}</p>
                <p className="text-sm text-zinc-500 truncate">{p.slug}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {!archived && (
                  <>
                    <button
                      type="button"
                      title={isFeatured ? "取消精選" : "設為精選"}
                      aria-label={isFeatured ? "取消精選" : "設為精選"}
                      aria-pressed={isFeatured}
                      disabled={isPending}
                      onClick={() => patchFeature(p.id, { is_featured: !isFeatured })}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors ${
                        isFeatured
                          ? "border-amber-300 bg-amber-50 text-amber-500 hover:bg-amber-100"
                          : "border-zinc-200 text-zinc-400 hover:text-amber-500 hover:border-amber-300"
                      } disabled:opacity-50`}
                    >
                      <Star className="h-4 w-4" fill={isFeatured ? "currentColor" : "none"} strokeWidth={2} />
                    </button>
                    <div className="flex items-center gap-1">
                      <label htmlFor={`priority-${p.id}`} className="text-xs text-zinc-500">排序</label>
                      <Input
                        id={`priority-${p.id}`}
                        type="number"
                        min={0}
                        max={9999}
                        step={1}
                        disabled={isPending}
                        defaultValue={p.display_priority ?? 0}
                        onBlur={e => {
                          const next = clampPriority(Number(e.currentTarget.value))
                          if (next === (p.display_priority ?? 0)) return
                          // reflect clamped value back to the input
                          e.currentTarget.value = String(next)
                          patchFeature(p.id, { display_priority: next })
                        }}
                        className="h-8 w-20 text-sm"
                      />
                    </div>
                  </>
                )}
                <Badge variant={p.is_active ? "default" : "secondary"}>
                  {p.is_active ? "上架" : "下架"}
                </Badge>
                {p.is_addon && <Badge variant="outline">加購</Badge>}
                {archived && <Badge variant="outline">已封存</Badge>}
                {!archived && (
                  <Link href={`/admin/products/${p.id}`}>
                    <Button variant="outline" size="sm">編輯</Button>
                  </Link>
                )}
                {archived ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => restoreProduct(p.id)}
                  >
                    還原
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => openDeleteModal(p)}
                  >
                    刪除
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-product-title"
          onClick={e => {
            if (e.target === e.currentTarget) closeDeleteModal()
          }}
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-lg">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 id="delete-product-title" className="text-sm font-semibold">
                刪除商品
              </h2>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={modalBusy}
                aria-label="關閉"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              <p className="text-sm text-zinc-600">
                即將處理商品「<span className="font-medium text-zinc-900">{deleteTarget.name}</span>」。
              </p>
              <ul className="space-y-1.5 text-sm text-zinc-600">
                <li>
                  <span className="font-medium text-zinc-900">封存</span>：商品下架並從清單隱藏，之後仍可還原（建議）。
                </li>
                <li>
                  <span className="font-medium text-red-600">永久刪除</span>：無法復原；若商品曾被下單只能封存。
                </li>
              </ul>

              {modalError && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {modalError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                disabled={modalBusy}
                onClick={closeDeleteModal}
              >
                取消
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                disabled={modalBusy}
                onClick={() => hardDeleteProduct(deleteTarget)}
              >
                永久刪除
              </Button>
              <Button
                size="sm"
                disabled={modalBusy}
                onClick={() => archiveProduct(deleteTarget)}
              >
                封存
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
