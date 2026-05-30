"use client"
import { useMemo, useState } from "react"
import Link from "next/link"
import { Star } from "lucide-react"
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
  display_priority?: number
  created_at: string
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

export default function AdminProductsClient({ initialProducts }: { initialProducts: Row[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialProducts.map(p => ({
      ...p,
      is_featured: p.is_featured ?? false,
      display_priority: p.display_priority ?? 0,
    })),
  )
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <>
      {error && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="border rounded-lg divide-y">
        {sorted.length === 0 && <p className="p-4 text-zinc-500">尚無商品</p>}
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
                <Badge variant={p.is_active ? "default" : "secondary"}>
                  {p.is_active ? "上架" : "下架"}
                </Badge>
                <Link href={`/admin/products/${p.id}`}>
                  <Button variant="outline" size="sm">編輯</Button>
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
