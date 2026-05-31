import type { Metadata } from "next"
import { Suspense } from "react"
import { Toaster } from "@/components/ui/sonner"
import { StorefrontShell } from "@/components/layout/StorefrontShell"
import { KolRefCapture } from "@/components/KolRefCapture"
import { Analytics } from "@/components/Analytics"
import { getCategories } from "@/lib/catalog"
import { createClient } from "@/lib/supabase/server"
import "./globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://realreal.cc"),
  title: {
    default: "誠真生活 RealReal | 純淨植物力健康食品",
    template: "%s | 誠真生活 RealReal",
  },
  description:
    "誠真生活 RealReal 是來自台灣的純素健康食品品牌，嚴選天然植物原料，提供高品質營養補充與健康零食，純粹投入，誠真健康。",
  keywords: [
    "誠真生活",
    "RealReal",
    "純素",
    "健康食品",
    "植物性",
    "台灣",
    "天然",
    "營養補充",
    "vegan",
  ],
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: "誠真生活 RealReal",
    title: "誠真生活 RealReal | 純淨植物力健康食品",
    description:
      "來自台灣的純素健康食品品牌，嚴選天然植物原料，純粹投入，誠真健康。",
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Categories (spec P) + auth state (spec Q) fetched server-side; passed down
  // through StorefrontShell so Header/Footer can render the right dropdown +
  // an avatar-style account chip when the user is logged in.
  const supabase = await createClient()
  const [categories, { data: { user } }] = await Promise.all([
    getCategories(),
    supabase.auth.getUser(),
  ])

  // Resolve initial letter for the avatar: display_name > email > null (logged out)
  let headerUser: { initial: string } | null = null
  if (user) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .single()
    const seed = (profile?.display_name?.trim() || user.email || "").trim()
    if (seed) headerUser = { initial: seed.charAt(0).toUpperCase() }
  }

  return (
    <html lang="zh-TW">
      <body className="font-sans antialiased">
        <Analytics />
        <Suspense fallback={null}>
          <KolRefCapture />
        </Suspense>
        <StorefrontShell categories={categories} headerUser={headerUser}>
          {children}
        </StorefrontShell>
        <Toaster />
      </body>
    </html>
  )
}
