"use client"

import { useEffect, useState } from "react"
import { adminFetch } from "@/lib/admin-fetch"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

interface CouponRow {
  id: string
  code: string
  type: string
  value: number
  is_active: boolean
}

interface CouponsResponse {
  data?: CouponRow[]
  coupons?: CouponRow[]
}

interface Props {
  name: string
  defaultValue?: string
  required?: boolean
  disabled?: boolean
}

/**
 * Dropdown picker for coupons. Fetches GET /admin/coupons on mount (admin JWT)
 * and emits the coupon's id via a single <select name={name}> field.
 *
 * Used by /admin/kols to link a KOL → a specific coupon. Mirrors the pattern
 * of the campaign-page _pickers (TierPicker / CategoryPicker / ProductPicker)
 * — admin auth via adminFetch, lazy hydration, blank "none" option, and a
 * select element that participates in standard FormData submission.
 */
export function CouponPicker({
  name,
  defaultValue = "",
  required = false,
  disabled = false,
}: Props) {
  const [coupons, setCoupons] = useState<CouponRow[]>([])
  const [value, setValue] = useState(defaultValue)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    adminFetch(`${API_URL}/admin/coupons`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((json: CouponsResponse) => {
        if (cancelled) return
        const rows = json?.data ?? json?.coupons ?? []
        setCoupons(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {
        if (!cancelled) setCoupons([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep displayed selection in sync if defaultValue changes (e.g. after
  // navigating between detail pages).
  useEffect(() => {
    setValue(defaultValue)
  }, [defaultValue])

  function formatLabel(c: CouponRow): string {
    if (c.type === "percentage") return `${c.code} — ${c.value}% off`
    if (c.type === "free_shipping") return `${c.code} — 免運`
    return `${c.code} — NT$ ${Number(c.value).toLocaleString()} off`
  }

  return (
    <select
      name={name}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className={selectClass}
      required={required}
      disabled={disabled || loading}
    >
      <option value="">
        {loading ? "載入中…" : "— 未綁定 coupon —"}
      </option>
      {coupons.map((c) => (
        <option key={c.id} value={c.id} disabled={!c.is_active}>
          {formatLabel(c)}
          {!c.is_active ? " (已停用)" : ""}
        </option>
      ))}
    </select>
  )
}
