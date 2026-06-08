import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { AdminTabs } from "../../_components/AdminTabs"
import { TestBenchClient } from "./_client"

export const metadata = { title: "行銷活動測試 | Admin" }

export default async function CampaignTestPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login?redirect=/admin/campaigns/test")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single()
  if (profile?.role !== "admin") redirect("/")

  // Tier list for the "custom" scenario dropdown
  const { data: tiers } = await supabase
    .from("membership_tiers")
    .select("id, name, discount_rate, min_spend")
    .order("min_spend", { ascending: true })

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <AdminTabs
        tabs={[
          { href: "/admin/campaigns", label: "行銷活動" },
          { href: "/admin/campaigns/test", label: "🧪 測試模擬" },
          { href: "/admin/coupons", label: "優惠券" },
          { href: "/admin/marketing/tiers", label: "會員等級" },
          { href: "/admin/marketing/points", label: "點數規則" },
        ]}
      />
      <div className="mt-6 mb-4">
        <h1 className="text-xl font-semibold text-[#10305a]">行銷活動測試模擬器</h1>
        <p className="mt-1 text-sm text-zinc-500">
          構造假購物車 + 假使用者情境，立刻看 evaluator 對每個 active 活動的判定（含未啟用的原因）。
          <span className="ml-2 text-emerald-600">Read-only：不會建訂單、不會扣庫存、不會增加 coupon used_count。</span>
        </p>
      </div>
      <TestBenchClient tiers={(tiers ?? []) as Array<{ id: string; name: string; discount_rate: number; min_spend: number }>} />
    </div>
  )
}
