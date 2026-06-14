"use client"

import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

export default function ContactForm() {
  const [sending, setSending] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // 必須在 await 之前抓住 form 參考：React 在事件處理函式的同步段結束後會把
    // e.currentTarget 設為 null，await 之後再讀就是 null。否則後面的
    // form.reset() 會拋 TypeError，即使信件已成功寄出也會誤報「送出失敗」。
    const form = e.currentTarget
    setSending(true)

    const fd = new FormData(form)
    const body = {
      name: fd.get("name"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      subject: fd.get("subject"),
      message: fd.get("message"),
    }

    try {
      const res = await fetch(`${API_URL}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        // 帶出後端真正的錯誤訊息，而不是一律顯示「送出失敗」
        let detail = `HTTP ${res.status}`
        try {
          const data = await res.json()
          if (data?.error) detail = String(data.error)
        } catch {
          // 回應不是 JSON，沿用狀態碼
        }
        throw new Error(detail)
      }

      toast.success("訊息已送出，我們會盡快回覆您！")
      form.reset()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`送出失敗：${msg}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="md:col-span-2 space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">姓名 *</Label>
          <Input
            id="name"
            name="name"
            required
            placeholder="您的姓名"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">電子信箱 *</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            placeholder="you@example.com"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="phone">聯絡電話</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            placeholder="09xx-xxx-xxx"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="subject">主旨 *</Label>
          <Input
            id="subject"
            name="subject"
            required
            placeholder="詢問主旨"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">訊息內容 *</Label>
        <Textarea
          id="message"
          name="message"
          required
          rows={6}
          placeholder="請輸入您想詢問的內容…"
        />
      </div>

      <Button type="submit" className="w-full sm:w-auto bg-[#10305a] hover:bg-[#10305a]/90 text-white rounded-[10px]" disabled={sending}>
        {sending ? "送出中…" : "送出訊息"}
      </Button>
    </form>
  )
}
