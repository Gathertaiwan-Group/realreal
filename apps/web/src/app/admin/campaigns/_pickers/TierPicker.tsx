"use client"

import { useEffect, useState } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

interface TierRow {
  id: string
  slug: string
  name: string
  sort_order?: number
}

interface Props {
  name: string
  defaultValue?: string
  required?: boolean
}

/**
 * Dropdown picker for membership tiers. Fetches GET /membership-tiers on
 * mount and emits the tier's slug via a single <select name={name}> field.
 *
 * Slug (not id) is the wire value because the existing
 * `tier_upgrade_bonus` campaign config — both in PRESET_TEMPLATES and
 * migration 0021 — keys on `tier_slug` (e.g. "gold", "diamond"). Schema
 * unchanged; this just swaps the raw-text input for a dropdown.
 */
export function TierPicker({ name, defaultValue = "", required = false }: Props) {
  const [tiers, setTiers] = useState<TierRow[]>([])
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/membership-tiers`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        const rows: TierRow[] = json?.data ?? []
        setTiers(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (!cancelled) setTiers([])
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
      <option value="">— 選擇會員等級 —</option>
      {tiers.map((t) => (
        <option key={t.slug || t.id} value={t.slug}>
          {t.name}
        </option>
      ))}
    </select>
  )
}
