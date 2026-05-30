"use client"

import { useEffect } from "react"
import { usePathname, useSearchParams } from "next/navigation"

/**
 * Client-side KOL referral capture (spec I).
 *
 * Mounted once in the root layout. On every navigation, reads `?ref=<slug>`
 * from the URL and persists it as a 7-day cookie so the checkout API can
 * attribute the order to the right KOL even if the customer browses around
 * before buying.
 *
 * Originally implemented as a Next.js middleware.ts but Next.js 16's
 * Turbopack build breaks Vercel deployment when middleware is present
 * (missing .nft.json file). Client-side capture is functionally identical
 * for our use case — server reads the cookie at checkout time regardless
 * of where it was set.
 */
const SLUG_RE = /^[a-z0-9-]+$/
const SEVEN_DAYS = 60 * 60 * 24 * 7

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "SameSite=Lax",
  ]
  if (window.location.protocol === "https:") parts.push("Secure")
  document.cookie = parts.join("; ")
}

export function KolRefCapture() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const ref = searchParams.get("ref")
    if (!ref || !SLUG_RE.test(ref)) return
    setCookie("kol_ref", ref, SEVEN_DAYS)
    setCookie("kol_ref_set_at", new Date().toISOString(), SEVEN_DAYS)
  }, [pathname, searchParams])

  return null
}
