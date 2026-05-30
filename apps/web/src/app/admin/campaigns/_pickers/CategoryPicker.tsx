"use client"

import { useEffect, useState } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

interface CategoryNode {
  id?: string
  slug: string
  name: string
  parent_id?: string | null
  sort_order?: number
  children?: CategoryNode[]
}

interface Props {
  name: string
  defaultValue?: string
  required?: boolean
}

/**
 * Dropdown picker for product categories.
 * Fetches GET /categories (tree), flattens into a flat list, and emits the
 * selected category's slug via a single <select name={name}> field so the
 * surrounding <form> serialises it like any other input.
 */
export function CategoryPicker({ name, defaultValue = "", required = false }: Props) {
  const [categories, setCategories] = useState<{ slug: string; name: string }[]>([])
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/categories`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        const raw: CategoryNode[] = json?.data ?? json?.categories ?? json ?? []
        const flat: { slug: string; name: string }[] = []
        const walk = (nodes: CategoryNode[]) => {
          for (const n of nodes) {
            if (n?.slug) flat.push({ slug: n.slug, name: n.name })
            if (n?.children?.length) walk(n.children)
          }
        }
        walk(Array.isArray(raw) ? raw : [])
        setCategories(flat)
      })
      .catch(() => {
        if (!cancelled) setCategories([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <select
      name={name}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className={selectClass}
      required={required}
    >
      <option value="">— 選擇分類 —</option>
      {categories.map((c) => (
        <option key={c.slug} value={c.slug}>
          {c.name}
        </option>
      ))}
    </select>
  )
}
