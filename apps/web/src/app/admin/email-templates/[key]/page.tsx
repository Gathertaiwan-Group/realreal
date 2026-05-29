"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const TEMPLATE_NAMES: Record<string, string> = {
  email_order_confirmation: "訂單確認",
  email_payment_confirmed: "付款成功通知",
  email_order_shipped: "出貨通知",
  email_tier_upgrade: "會員升級通知",
  email_subscription_billed: "訂閱扣款成功",
  email_subscription_failed: "訂閱扣款失敗",
}

const TEMPLATE_VARIABLES: Record<string, string> = {
  email_order_confirmation:
    "{{orderNumber}}, {{items}}, {{total}}, {{address}}",
  email_payment_confirmed: "{{orderNumber}}, {{amount}}, {{method}}",
  email_order_shipped:
    "{{orderNumber}}, {{trackingNumber}}, {{carrier}}",
  email_tier_upgrade: "{{newTier}}, {{discountRate}}, {{benefits}}",
  email_subscription_billed:
    "{{planName}}, {{amount}}, {{nextBillingDate}}, {{orderNumber}}",
  email_subscription_failed:
    "{{planName}}, {{retryDate}}, {{manageUrl}}",
}

export default function AdminEmailTemplateEditorPage() {
  const params = useParams<{ key: string }>()
  const router = useRouter()
  const key = params.key
  const label = TEMPLATE_NAMES[key] ?? key

  const [subject, setSubject] = useState("")
  const [bodyHtml, setBodyHtml] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    async function fetchTemplate() {
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${API_URL}/site-contents/${key}`, {
          headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        })
        if (res.ok) {
          const data = await res.json()
          const value = data.value ?? data.data ?? data
          setSubject(value.subject ?? "")
          setBodyHtml(value.body_html ?? "")
        }
      } catch {
        toast.error("載入模板失敗")
      } finally {
        setLoading(false)
      }
    }
    fetchTemplate()
  }, [key])

  useEffect(() => {
    if (showPreview && iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(bodyHtml)
        doc.close()
      }
    }
  }, [showPreview, bodyHtml])

  async function handleSave() {
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/admin/site-contents/${key}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ value: { subject, body_html: bodyHtml } }),
      })
      if (res.ok) toast.success("已儲存")
      else toast.error("儲存失敗")
    } catch {
      toast.error("儲存失敗")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-[#687279]">載入中...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="rounded-[10px]"
          onClick={() => router.push("/admin/email-templates")}
        >
          &larr; 返回
        </Button>
        <h1 className="text-xl font-semibold text-[#10305a]">
          編輯：{label}
        </h1>
      </div>

      {/* Available variables hint */}
      {TEMPLATE_VARIABLES[key] && (
        <Card className="rounded-[10px] border-[#10305a]/10 bg-[#fffeee]">
          <CardContent className="py-3 px-4">
            <p className="text-xs text-[#687279]">
              <span className="font-medium text-[#10305a]">可用變數：</span>
              {TEMPLATE_VARIABLES[key]}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-[10px]">
        <CardHeader>
          <CardTitle className="text-sm text-[#10305a]">
            模板內容
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email-subject">主旨 (Subject)</Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email 主旨..."
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email-body">內文 HTML (Body)</Label>
            <textarea
              id="email-body"
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              placeholder="<html>...</html>"
              rows={20}
              className="w-full rounded-[10px] border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <div className="flex gap-3">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="rounded-[10px] bg-[#10305a] hover:bg-[#10305a]/90"
            >
              {saving ? "儲存中..." : "儲存"}
            </Button>
            <Button
              variant="outline"
              className="rounded-[10px]"
              onClick={() => setShowPreview((prev) => !prev)}
            >
              {showPreview ? "隱藏預覽" : "預覽"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showPreview && (
        <Card className="rounded-[10px]">
          <CardHeader>
            <CardTitle className="text-sm text-[#10305a]">
              Email 預覽
            </CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              ref={iframeRef}
              title="Email Preview"
              className="w-full min-h-[400px] rounded-[10px] border"
              sandbox="allow-same-origin"
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
