"use client"

import { usePathname } from "next/navigation"
import { Header } from "./Header"
import { Footer } from "./Footer"
import type { Category } from "@/lib/catalog"

export function StorefrontShell({
  children,
  categories,
}: {
  children: React.ReactNode
  categories: Category[]
}) {
  const pathname = usePathname()
  const isAdmin = pathname.startsWith("/admin")

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <>
      <Header categories={categories} />
      <main className="min-h-[calc(100vh-4rem)]">{children}</main>
      <Footer categories={categories} />
    </>
  )
}
