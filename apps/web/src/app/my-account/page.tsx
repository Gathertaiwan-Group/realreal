import { redirect } from "next/navigation"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { apiClient } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ShoppingCart, Crown, DollarSign, RefreshCw } from "lucide-react"

export const metadata = { title: "帳戶總覽 | 誠真生活 RealReal" }

type Order = {
  id: string
  order_number: string
  created_at: string
  status: string
  total: number
}

type SubRow = {
  id: string
  status: string
  subscription_plans: { name: string; price: string; interval: string } | null
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待付款",
  paid: "已付款",
  shipped: "出貨中",
  delivered: "已送達",
  cancelled: "已取消",
}

export default async function MyAccountPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const accessToken = session?.access_token ?? ""

  // Fetch profile, orders, and subscriptions in parallel
  const [profileResult, ordersResult, subscriptionsResult] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("display_name, total_spend, membership_tiers(name)")
      .eq("user_id", user.id)
      .single(),
    apiClient<{ data: Order[] }>("/orders", { token: accessToken }).catch(
      () => ({ data: [] }) as { data: Order[] }
    ),
    supabase
      .from("subscriptions")
      .select("id, status, subscription_plans(name, price, interval)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
  ])

  const profile = profileResult.data
  const displayName = profile?.display_name ?? user.email?.split("@")[0] ?? "會員"
  const totalSpend: number = profile?.total_spend ?? 0
  const rawTier = profile?.membership_tiers as unknown
  const tierName =
    (Array.isArray(rawTier)
      ? (rawTier[0] as { name: string } | undefined)?.name
      : (rawTier as { name: string } | null)?.name) ?? "一般會員"

  const orders: Order[] = ordersResult.data ?? []
  const recentOrders = orders.slice(0, 3)
  const totalOrders = orders.length

  const activeSubscriptions: SubRow[] =
    (subscriptionsResult.data as unknown as SubRow[]) ?? []

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2 text-[#10305a]">歡迎回來，{displayName}</h1>
      <p className="text-[#687279] mb-8">管理您的帳戶、訂單與訂閱</p>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <Card className="border-[#10305a]/10">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-[#10305a]/10 flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-[#10305a]" />
            </div>
            <div>
              <p className="text-sm text-[#687279]">總訂單數</p>
              <p className="text-xl font-semibold text-[#10305a]">{totalOrders}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#10305a]/10">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-[#10305a]/10 flex items-center justify-center">
              <Crown className="w-5 h-5 text-[#10305a]" />
            </div>
            <div>
              <p className="text-sm text-[#687279]">會員等級</p>
              <p className="text-xl font-semibold text-[#10305a]">{tierName}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-[#10305a]/10">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-[#10305a]/10 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-[#10305a]" />
            </div>
            <div>
              <p className="text-sm text-[#687279]">累計消費</p>
              <p className="text-xl font-semibold text-[#10305a]">
                NT${totalSpend.toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Orders */}
      <Card className="mb-8">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg text-[#10305a]">近期訂單</CardTitle>
          <Link href="/my-account/orders">
            <Button variant="ghost" size="sm">
              查看全部
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-zinc-400 py-4 text-center">
              尚無訂單記錄
            </p>
          ) : (
            <div className="divide-y">
              {recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium font-mono">
                      {order.order_number}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {new Date(order.created_at).toLocaleDateString("zh-TW")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">
                      {STATUS_LABELS[order.status] ?? order.status}
                    </Badge>
                    <span className="text-sm font-semibold">
                      NT$ {Number(order.total).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Subscriptions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg text-[#10305a]">訂閱方案</CardTitle>
          <Link href="/my-account/subscriptions">
            <Button variant="ghost" size="sm">
              管理訂閱
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {activeSubscriptions.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-zinc-400 mb-3">目前沒有進行中的訂閱</p>
              <Link href="/subscribe">
                <Button variant="outline" size="sm">
                  <RefreshCw className="w-4 h-4 mr-1" />
                  探索訂閱方案
                </Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y">
              {activeSubscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {sub.subscription_plans?.name ?? "訂閱方案"}
                    </p>
                    <p className="text-xs text-zinc-500">
                      NT${Number(sub.subscription_plans?.price ?? 0).toLocaleString()}{" "}
                      / {sub.subscription_plans?.interval === "month" ? "月" : "年"}
                    </p>
                  </div>
                  <Badge variant="default">進行中</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
