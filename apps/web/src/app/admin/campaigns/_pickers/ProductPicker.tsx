"use client"

import { useEffect, useState } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

interface ProductHit {
  sku: string
  name: string
}

interface Props {
  skuName: string
  nameFieldName: string
  defaultSku?: string
  defaultName?: string
}

/**
 * Type-ahead picker for products. Debounces the search 300ms, hits
 * GET /products?search=...&limit=10, and surfaces up to 10 matches in a
 * floating list. Selecting an item fills two hidden inputs ({skuName},
 * {nameFieldName}) so the existing campaign-config form serialises both
 * the SKU and the display name without any caller changes.
 */
export function ProductPicker({
  skuName,
  nameFieldName,
  defaultSku = "",
  defaultName = "",
}: Props) {
  const [query, setQuery] = useState(defaultName)
  const [selected, setSelected] = useState<ProductHit | null>(
    defaultSku ? { sku: defaultSku, name: defaultName } : null,
  )
  const [results, setResults] = useState<ProductHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    // Don't refetch when the input value mirrors the currently-selected name.
    if (selected && selected.name === query) return

    let cancelled = false
    setLoading(true)
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API_URL}/products?search=${encodeURIComponent(query)}&limit=10`,
        )
        const json = await res.json()
        if (cancelled) return
        const items: ProductHit[] = ((json?.data ?? []) as any[])
          .flatMap((p) => {
            const variants = Array.isArray(p?.variants) && p.variants.length > 0
              ? p.variants
              : [{ sku: p?.sku }]
            return variants.map((v: any) => ({
              sku: (v?.sku ?? p?.sku ?? "") as string,
              name: (p?.name ?? "") as string,
            }))
          })
          .filter((x) => x.sku)
        setResults(items)
        setOpen(true)
      } catch {
        if (!cancelled) {
          setResults([])
          setOpen(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, selected])

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          // Typing invalidates the current selection so the hidden inputs
          // clear out — caller can detect an empty SKU as "no choice yet".
          setSelected(null)
        }}
        onFocus={() => {
          if (results.length > 0) setOpen(true)
        }}
        placeholder="搜尋商品名稱…"
        className={inputClass}
        autoComplete="off"
      />
      {/* Hidden fields actually submitted with the surrounding form. */}
      <input type="hidden" name={skuName} value={selected?.sku ?? ""} />
      <input type="hidden" name={nameFieldName} value={selected?.name ?? ""} />

      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded border border-gray-200 bg-white shadow">
          {results.map((r) => (
            <li key={`${r.sku}-${r.name}`}>
              <button
                type="button"
                onClick={() => {
                  setSelected(r)
                  setQuery(r.name)
                  setOpen(false)
                }}
                className="block w-full px-3 py-2 text-left hover:bg-zinc-50"
              >
                <div className="text-sm font-medium">{r.name}</div>
                <div className="font-mono text-xs text-zinc-500">{r.sku}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {loading && !open && (
        <div className="mt-1 text-xs text-zinc-400">搜尋中…</div>
      )}

      {selected && (
        <div className="mt-1 text-xs text-zinc-500">
          已選：{selected.name}{" "}
          <span className="font-mono">({selected.sku})</span>
        </div>
      )}
    </div>
  )
}
