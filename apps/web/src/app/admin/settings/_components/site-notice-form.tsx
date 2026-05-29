"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface SiteNoticeFormProps {
  message: string
  active: boolean
  variant: "info" | "warning" | "success"
}

export default function SiteNoticeForm({
  message: initialMessage,
  active: initialActive,
  variant: initialVariant,
}: SiteNoticeFormProps) {
  const [message, setMessage] = useState(initialMessage)
  const [active, setActive] = useState(initialActive)
  const [variant, setVariant] = useState<"info" | "warning" | "success">(initialVariant)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      await fetch(`${API_URL}/admin/settings/site-notice`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ message, active, variant }),
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="notice-message">公告內容</Label>
        <Input
          id="notice-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="輸入公告訊息..."
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="notice-variant">公告類型</Label>
        <select
          id="notice-variant"
          value={variant}
          onChange={(e) => setVariant(e.target.value as "info" | "warning" | "success")}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        >
          <option value="info">資訊 (info)</option>
          <option value="warning">警告 (warning)</option>
          <option value="success">成功 (success)</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="notice-active"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4"
        />
        <Label htmlFor="notice-active">啟用公告橫幅</Label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "儲存中..." : "儲存設定"}
        </Button>
        {saved && <span className="text-sm text-green-600">已儲存</span>}
      </div>
    </form>
  )
}
