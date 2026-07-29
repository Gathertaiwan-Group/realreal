"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { normalizeAdminCategories } from "@/lib/admin-categories"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

interface ProductRow {
  id: string
  name: string
  images: string[] | null
  category_id: string | null
}

interface CategoryRow {
  id: string
  name: string
}

interface Props {
  name: string
  defaultValue?: string[]
}

/**
 * Multi-select + reorderable picker for a KOL's recommended products.
 *
 * Fetches all active products (GET /products?limit=100, public endpoint —
 * already filters is_active=true) and categories on mount, renders a
 * checklist grouped by category, plus a reorderable "已選商品" strip with
 * ▲▼ buttons. Emits the ordered id list via a hidden input so the
 * surrounding <form> (native FormData submission, same pattern as
 * CouponPicker) picks it up under `name`.
 *
 * Hidden-input CSV contract: the hidden input's value is
 * `selected.join(",")` — a comma-separated list of product UUIDs, in
 * display order. When nothing is selected this is `""` (empty string), NOT
 * an empty list. Consumers reading this field (e.g. via
 * `formData.get(name)`) MUST guard that case explicitly, e.g.:
 *   const raw = formData.get(name)?.toString() ?? ""
 *   const ids = raw ? raw.split(",").filter(Boolean) : []
 * Naively doing `raw.split(",")` on an empty string yields `[""]` (a
 * one-element array containing an empty string), which fails the API's
 * `z.array(z.string().uuid())` validation — so clearing all recommended
 * products would 400 instead of saving an empty list.
 */
export function RecommendedProductsPicker({ name, defaultValue = [] }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [selected, setSelected] = useState<string[]>(defaultValue)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${API_URL}/products?limit=100`).then((r) => (r.ok ? r.json() : { data: [] })),
      fetch(`${API_URL}/categories`).then((r) => (r.ok ? r.json() : { data: [] })),
    ])
      .then(([productsJson, categoriesJson]) => {
        if (cancelled) return
        setProducts(productsJson?.data ?? [])
        // GET /categories returns a TREE (top-level categories with nested
        // `children[]`), not a flat list. Flatten it so categoryName() can
        // find subcategory rows too — otherwise any product whose
        // category_id points at a subcategory would silently fall into
        // "未分類" because a raw `.find()` never descends into `children`.
        setCategories(
          normalizeAdminCategories(categoriesJson?.data ?? categoriesJson?.categories ?? []),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setProducts([])
          setCategories([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSelected(defaultValue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue.join(",")])

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function move(id: string, dir: -1 | 1) {
    setSelected((prev) => {
      const idx = prev.indexOf(id)
      const next = idx + dir
      if (idx === -1 || next < 0 || next >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
      return copy
    })
  }

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? "未分類"

  const grouped = products.reduce<Record<string, ProductRow[]>>((acc, p) => {
    const key = categoryName(p.category_id)
    ;(acc[key] ??= []).push(p)
    return acc
  }, {})

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id

  return (
    <div className="space-y-4">
      {/*
        CSV contract: comma-separated product UUIDs in display order.
        Empty selection encodes as "" — NOT "[]". Readers must guard:
          const ids = raw ? raw.split(",").filter(Boolean) : []
        (naive raw.split(",") on "" yields [""], which fails the API's
        z.array(z.string().uuid()) validation). See top-of-file JSDoc.
      */}
      <input type="hidden" name={name} value={selected.join(",")} />

      {loading ? (
        <p className="text-xs text-zinc-400">載入商品清單中…</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-input p-3 space-y-3">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <p className="text-xs font-semibold text-zinc-500 mb-1">{category}</p>
              <div className="space-y-1">
                {items.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    {p.images?.[0] && (
                      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded bg-zinc-100">
                        <Image src={p.images[0]} alt="" fill sizes="32px" className="object-cover" unoptimized />
                      </span>
                    )}
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-zinc-500">已選商品（顯示順序）</p>
          <ul className="space-y-1">
            {selected.map((id, idx) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border border-input px-2 py-1 text-sm"
              >
                <span>{idx + 1}. {productName(id)}</span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(id, -1)}
                    disabled={idx === 0}
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-30"
                    aria-label="上移"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(id, 1)}
                    disabled={idx === selected.length - 1}
                    className="rounded px-1.5 py-0.5 text-xs hover:bg-zinc-100 disabled:opacity-30"
                    aria-label="下移"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50"
                    aria-label="移除"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
