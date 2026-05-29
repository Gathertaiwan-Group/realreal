import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { SubscriptionsListClient } from "./subscriptions-list-client"

export const metadata = { title: "我的訂閱 | 我的帳戶" }

type SubRow = {
  id: string
  status: "active" | "paused" | "cancelled" | "past_due"
  next_billing_date: string | null
  retry_count: number
  subscription_plans: { name: string; price: string; interval: string }
}

export default async function MySubscriptionsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login?redirect=/my-account/subscriptions")

  const { data: subscriptions } = await supabase
    .from("subscriptions")
    .select(`
      id, status, next_billing_date, retry_count,
      subscription_plans (name, price, interval)
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <Link
        href="/my-account"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[#10305a] hover:underline"
      >
        <ChevronLeft className="h-4 w-4" />
        回帳戶概覽
      </Link>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-[#10305a]">我的訂閱</h1>
        <Link
          href="/subscribe"
          className="text-sm text-[#10305a] underline underline-offset-4 hover:text-[#1a4070]"
        >
          新增訂閱
        </Link>
      </div>

      {!subscriptions?.length ? (
        <div className="text-center py-20 text-zinc-400">
          <p>您目前沒有訂閱方案</p>
          <Link
            href="/subscribe"
            className="mt-4 inline-block rounded-[10px] bg-[#10305a] hover:bg-[#1a4070] text-white px-6 py-2 text-sm"
          >
            立即訂閱
          </Link>
        </div>
      ) : (
        <SubscriptionsListClient subscriptions={subscriptions as unknown as SubRow[]} />
      )}
    </div>
  )
}
