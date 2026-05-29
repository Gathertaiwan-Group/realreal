"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Settings as SettingsIcon, Mail } from "lucide-react"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AdminTabs } from "../../_components/AdminTabs"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const SETTINGS_TABS = [
  { href: "/admin/settings", label: "系統參數" },
  { href: "/admin/settings/team", label: "團隊成員" },
  { href: "/admin/settings/email-templates", label: "Email 模板" },
]

const TEMPLATE_NAMES: Record<string, string> = {
  email_order_confirmation: "訂單確認",
  email_payment_confirmed: "付款成功通知",
  email_order_shipped: "出貨通知",
  email_tier_upgrade: "會員升級通知",
  email_subscription_billed: "訂閱扣款成功",
  email_subscription_failed: "訂閱扣款失敗",
}

interface SiteContent {
  key: string
  value: { subject?: string; body_html?: string }
}

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<SiteContent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${API_URL}/admin/site-contents`, {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        })
        if (!res.ok) throw new Error("fetch failed")
        const data: SiteContent[] = await res.json()
        const emailTemplates = (data ?? []).filter((item) =>
          item.key.startsWith("email_"),
        )
        setTemplates(emailTemplates)
      } catch {
        toast.error("載入 Email 模板失敗")
      } finally {
        setLoading(false)
      }
    }
    void fetchTemplates()
  }, [])

  const allKeys = Object.keys(TEMPLATE_NAMES)
  const templateMap = new Map(templates.map((t) => [t.key, t]))

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <div className="mb-3 flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-[#10305a]" />
          <h1 className="text-2xl font-semibold text-[#10305a]">設定</h1>
        </div>
        <AdminTabs tabs={SETTINGS_TABS} />
        <p className="text-sm text-zinc-500">
          Email 模板管理。修改後系統會用新模板寄送通知信。
        </p>
      </header>

      <div className="flex items-center gap-2">
        <Mail className="h-5 w-5 text-[#10305a]" />
        <h2 className="text-base font-semibold text-[#10305a]">通知信模板</h2>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">載入中…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {allKeys.map((key) => {
            const template = templateMap.get(key)
            const subject = template?.value?.subject ?? ""
            return (
              <Card key={key} className="rounded-[10px]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#10305a]">
                    {TEMPLATE_NAMES[key]}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-[#687279] truncate">
                    {subject ? `主旨：${subject}` : "尚未設定主旨"}
                  </p>
                  <Link href={`/admin/email-templates/${key}`}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-[10px] text-[#10305a] border-[#10305a]/20 hover:bg-[#10305a]/5"
                    >
                      編輯
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
