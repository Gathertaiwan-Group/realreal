import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Badge } from "@/components/ui/badge"

export const metadata = { title: "發票管理 | Admin" }

type InvoiceStatus = "pending" | "issued" | "voided" | "error"

interface InvoiceRow {
  id: string
  invoice_number: string | null
  order_id: string
  type: string
  amount: string
  status: InvoiceStatus
  issued_at: string | null
}

interface InvoicesResponse {
  data: InvoiceRow[]
  total: number
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待開立",
  issued: "已開立",
  voided: "已作廢",
  error: "開立失敗",
}

const TYPE_LABEL: Record<string, string> = {
  B2C_2: "雲端發票",
  B2C_3: "載具發票",
  B2B: "統編發票",
}

export default async function AdminInvoicesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<{ role: string }>()
  if (profile?.role !== "admin") redirect("/")

  const API_URL = process.env.RAILWAY_API_URL ?? "http://localhost:4000"

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token ?? ""

  let invoices: InvoiceRow[] = []

  try {
    const res = await fetch(`${API_URL}/admin/invoices`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      next: { revalidate: 30 },
    })
    if (res.ok) {
      const data: InvoicesResponse = await res.json()
      invoices = data.data ?? []
    }
  } catch {
    // API unavailable — show empty state
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-8">發票管理</h1>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">發票號碼</th>
              <th className="text-left px-4 py-3 font-medium">訂單編號</th>
              <th className="text-left px-4 py-3 font-medium">類型</th>
              <th className="text-right px-4 py-3 font-medium">金額</th>
              <th className="text-left px-4 py-3 font-medium">狀態</th>
              <th className="text-left px-4 py-3 font-medium">開立時間</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                  暫無發票資料
                </td>
              </tr>
            ) : (
              invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    {inv.invoice_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{inv.order_id}</td>
                  <td className="px-4 py-3">
                    {TYPE_LABEL[inv.type] ?? inv.type}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    NT${Number(inv.amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        inv.status === "issued"
                          ? "default"
                          : inv.status === "voided"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {inv.issued_at
                      ? new Date(inv.issued_at).toLocaleString("zh-TW")
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {(inv.status === "pending" || inv.status === "error") && (
                      <form action={`${API_URL}/admin/invoices/${inv.id}/reissue`} method="POST">
                        <button
                          type="submit"
                          className="text-xs text-blue-600 hover:underline"
                        >
                          重新開立
                        </button>
                      </form>
                    )}
                    {inv.status === "issued" && (
                      <form action={`${API_URL}/admin/invoices/${inv.id}/void`} method="POST">
                        <button
                          type="submit"
                          className="text-xs text-destructive hover:underline"
                        >
                          作廢
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
