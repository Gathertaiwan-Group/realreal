"use client"

import { useCallback, useEffect, useState } from "react"
import { Settings as SettingsIcon, Eye, Save, ChevronDown, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AdminTabs } from "../_components/AdminTabs"

const SETTINGS_TABS = [
  { href: "/admin/settings", label: "系統參數" },
  { href: "/admin/settings/team", label: "團隊成員" },
  { href: "/admin/settings/email-templates", label: "Email 模板" },
  { href: "/admin/settings/carousel", label: "顧客回饋輪播" },
]

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

interface FieldState {
  set: boolean
  value?: string | null
  preview?: string
}

interface Field {
  key: string
  secret: boolean
  state: FieldState
}

interface Section {
  key: string
  label: string
  fields: Field[]
}

// UI labels + types per known key. Anything not listed falls back to a plain
// text input with the bare key as label.
const FIELD_META: Record<
  string,
  { label: string; hint?: string; type?: "text" | "switch" | "select"; options?: string[]; placeholder?: string }
> = {
  // PChomePay
  "pchomepay.app_id":     { label: "APP ID", placeholder: "由 PChomePay 後台取得" },
  "pchomepay.secret":     { label: "Secret", placeholder: "由 PChomePay 後台取得" },
  "pchomepay.hash_key":   { label: "Hash Key", placeholder: "Webhook 驗章用" },
  "pchomepay.hash_iv":    { label: "Hash IV", placeholder: "Webhook 驗章用" },
  "pchomepay.sandbox":    { label: "沙箱模式", type: "switch", hint: "開啟 = 走 sandbox-api.pchomepay.com.tw" },
  "pchomepay.pay_types":  { label: "啟用付款方式", hint: "逗號分隔：CARD,ATM,ACCT,EACH,PI", placeholder: "CARD,ATM,ACCT,EACH,PI" },
  // LINE Pay
  "linepay.channel_id":     { label: "Channel ID" },
  "linepay.channel_secret": { label: "Channel Secret" },
  "linepay.sandbox":        { label: "沙箱模式", type: "switch" },
  // JKOPay
  "jkopay.store_id":   { label: "Store ID" },
  "jkopay.api_key":    { label: "API Key" },
  "jkopay.secret_key": { label: "Secret Key" },
  "jkopay.sandbox":    { label: "沙箱模式", type: "switch", hint: "關閉 = 正式 onlinepay.jkopay.com｜開啟 = 測試 uat-onlinepay.jkopay.app" },
  // ECPay
  "ecpay.merchant_id":    { label: "Merchant ID", hint: "綠界「物流 (C2C)」專用帳號，與線上刷卡的金流帳號不同" },
  "ecpay.hash_key":       { label: "Hash Key", hint: "物流帳號的 HashKey（綠界後台 → 系統開發管理）" },
  "ecpay.hash_iv":        { label: "Hash IV" },
  "ecpay.sandbox":        { label: "沙箱模式", type: "switch", hint: "開=測試環境(logistics-stage)；正式上線前需先完成綠界 7-11/全家 C2C 測標，再關閉" },
  "ecpay.sender_name":    { label: "寄件人姓名", placeholder: "誠真生活" },
  "ecpay.sender_phone":   { label: "寄件人電話", placeholder: "0912345678" },
  "ecpay.sender_zip":     { label: "寄件人郵遞區號", placeholder: "100" },
  "ecpay.sender_city":    { label: "寄件人縣市", placeholder: "台北市" },
  "ecpay.sender_address": { label: "寄件人地址", placeholder: "中正區...." },
  // Amego
  "amego.tax_id":          { label: "公司統編 (作為帳號)" },
  "amego.app_key":         { label: "App Key" },
  "amego.sandbox":         { label: "沙箱模式", type: "switch" },
  // Resend
  "resend.api_key":       { label: "Resend API Key", placeholder: "re_…" },
  "resend.from_address":  { label: "寄件 Email", placeholder: "love@realreal.cc 或 \"誠真生活 <love@realreal.cc>\"" },
  "resend.from_name":     { label: "寄件人顯示名稱", placeholder: "誠真生活 RealReal" },
  // Notifications
  "notifications.admin_email": {
    label: "管理員收件 Email（訂單通知＋聯絡表單）",
    hint: "兩個都會寄到這裡：① 新訂單成立通知信 ② 首頁底部「聯絡我們」表單送出的訊息。改完 30 秒內全站生效，不需重新部署。",
    placeholder: "orders@realreal.cc",
  },
  "notifications.line_notify_token": {
    label: "LINE Notify Token",
    hint: "用於新訂單通知 + 線上錯誤即時提醒",
    placeholder: "xxxxxxxxxxxx",
  },
  // Analytics
  "analytics.ga4_measurement_id": {
    label: "GA4 Measurement ID",
    hint: "改完後須 Vercel + Railway re-deploy 才生效",
    placeholder: "G-XXXXXXXXXX",
  },
  "analytics.gtm_id": {
    label: "GTM Container ID",
    hint: "改完後須 Vercel + Railway re-deploy 才生效",
    placeholder: "GTM-XXXXXX",
  },
  "analytics.sentry_dsn_web": {
    label: "Sentry DSN (Web)",
    hint: "改完後須 Vercel + Railway re-deploy 才生效",
    placeholder: "https://...@...ingest.sentry.io/...",
  },
  "analytics.sentry_dsn_api": {
    label: "Sentry DSN (API)",
    hint: "改完後須 Vercel + Railway re-deploy 才生效",
    placeholder: "https://...@...ingest.sentry.io/...",
  },
  // Marketing
  "marketing.meta_pixel_id": {
    label: "Meta Pixel ID",
    hint: "實際 tag 配置在 GTM workspace；此處僅供記錄",
    placeholder: "16-digit number",
  },
  "marketing.clarity_id": {
    label: "Microsoft Clarity ID",
    hint: "實際 tag 配置在 GTM workspace；此處僅供記錄",
    placeholder: "10-char alphanumeric",
  },
  // Shipping
  "shipping.fee_home_delivery":   { label: "宅配運費 NT$", placeholder: "150" },
  "shipping.fee_cvs":             { label: "超商運費 NT$", placeholder: "65" },
  "shipping.fee_cvs_cod":         { label: "超商取貨付款運費 NT$", placeholder: "80", hint: "超商取貨付款（代收貨款）專屬費率，不提供免運優惠" },
  "shipping.free_threshold_home": { label: "宅配免運門檻 NT$", placeholder: "1499", hint: "0 = 不提供免運" },
  "shipping.free_threshold_cvs":  { label: "超商免運門檻 NT$", placeholder: "499", hint: "0 = 不提供免運" },
  "shipping.fee_overseas_cod":    { label: "海外到付運費（顯示用）", placeholder: "0", hint: "實際由司機收取，固定顯示 NT$0，此設定僅供備忘" },
  // Contact
  "contact.email": { label: "客服 Email", placeholder: "love@realreal.cc" },
}

function fieldLabel(key: string): string {
  return FIELD_META[key]?.label ?? key
}
function fieldHint(key: string): string | undefined {
  return FIELD_META[key]?.hint
}
function fieldType(key: string): "text" | "switch" | "select" {
  return FIELD_META[key]?.type ?? "text"
}
function fieldPlaceholder(key: string): string | undefined {
  return FIELD_META[key]?.placeholder
}

interface SectionDrafts {
  // key -> in-progress value entered by user. undefined = untouched (keep server state).
  // null = explicitly cleared.
  [fieldKey: string]: string | null | undefined
}

interface RevealedSet {
  [fieldKey: string]: boolean
}

export default function AdminSettingsPage() {
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, SectionDrafts>>({})
  const [revealed, setRevealed] = useState<RevealedSet>({})
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/settings`)
      if (!res.ok) throw new Error(await res.text())
      const data = (await res.json()) as { sections: Section[] }
      setSections(data.sections)
      setDrafts({})
      setRevealed({})
    } catch (err) {
      console.error(err)
      toast.error("載入設定失敗")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function setDraft(sectionKey: string, fieldKey: string, value: string | null | undefined) {
    setDrafts((d) => ({
      ...d,
      [sectionKey]: { ...(d[sectionKey] ?? {}), [fieldKey]: value },
    }))
  }

  async function saveSection(section: Section) {
    const sectionDrafts = drafts[section.key] ?? {}
    const dirtyEntries = Object.entries(sectionDrafts).filter(
      ([, v]) => v !== undefined,
    )
    if (dirtyEntries.length === 0) {
      toast.message("沒有變更")
      return
    }

    setSavingSection(section.key)
    try {
      const results = await Promise.all(
        dirtyEntries.map(async ([key, value]) => {
          const res = await adminFetch(`${API_URL}/admin/settings`, {
            method: "PUT",
            body: JSON.stringify({ key, value: value === null ? null : value }),
          })
          if (!res.ok) {
            const detail = await res.text()
            throw new Error(`儲存 ${fieldLabel(key)} 失敗：${detail}`)
          }
          return key
        }),
      )
      toast.success(`已儲存並生效（${results.length} 項）`)
      await load() // refresh server state
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(msg)
    } finally {
      setSavingSection(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-zinc-500">載入中…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <div className="mb-3 flex items-center gap-3">
          <SettingsIcon className="h-6 w-6 text-[#10305a]" />
          <h1 className="text-2xl font-semibold text-[#10305a]">設定</h1>
        </div>
        <AdminTabs tabs={SETTINGS_TABS} />
        <p className="text-sm text-zinc-500">
          金流、發票、物流、通知信參數熱更新。儲存後 30 秒內全站生效，
          不需重新部署。Secret 欄位儲存後僅顯示遮罩末四碼。
        </p>
      </header>

      {sections.map((section) => {
        const isCollapsed = collapsed[section.key]
        const isSaving = savingSection === section.key
        const dirtyCount = Object.values(drafts[section.key] ?? {}).filter(
          (v) => v !== undefined,
        ).length

        return (
          <section
            key={section.key}
            className="rounded-[10px] border bg-white shadow-sm"
          >
            <button
              type="button"
              onClick={() =>
                setCollapsed((c) => ({ ...c, [section.key]: !c[section.key] }))
              }
              className="flex w-full items-center justify-between px-5 py-4 hover:bg-zinc-50 transition-colors rounded-t-[10px]"
            >
              <div className="flex items-center gap-3">
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-zinc-500" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-zinc-500" />
                )}
                <h2 className="text-base font-semibold text-[#10305a]">
                  {section.label}
                </h2>
                {dirtyCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                    {dirtyCount} 項待儲存
                  </span>
                )}
              </div>
            </button>

            {!isCollapsed && (
              <div className="border-t px-5 py-4 space-y-4">
                {section.fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    revealed={revealed[field.key] ?? false}
                    onReveal={(v) =>
                      setRevealed((r) => ({ ...r, [field.key]: v }))
                    }
                    draftValue={drafts[section.key]?.[field.key]}
                    onChange={(v) => setDraft(section.key, field.key, v)}
                  />
                ))}

                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    onClick={() => void saveSection(section)}
                    disabled={dirtyCount === 0 || isSaving}
                    className="bg-[#10305a] text-white hover:bg-[#10305a]/90"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {isSaving ? "儲存中…" : `儲存本區${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function FieldRow({
  field,
  revealed,
  onReveal,
  draftValue,
  onChange,
}: {
  field: Field
  revealed: boolean
  onReveal: (v: boolean) => void
  draftValue: string | null | undefined
  onChange: (v: string | null | undefined) => void
}) {
  const type = fieldType(field.key)
  const label = fieldLabel(field.key)
  const hint = fieldHint(field.key)
  const placeholder = fieldPlaceholder(field.key)

  // ---- Switch (boolean stored as "true"/"false") ----
  if (type === "switch") {
    const current = draftValue !== undefined ? draftValue : field.state.value
    const isOn = current === "true"
    return (
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-sm font-medium text-zinc-900">{label}</Label>
          {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          onClick={() => onChange(isOn ? "false" : "true")}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isOn ? "bg-[#10305a]" : "bg-zinc-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              isOn ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    )
  }

  // ---- Secret field with reveal toggle ----
  if (field.secret) {
    const isEditing = revealed || draftValue !== undefined
    if (field.state.set && !isEditing) {
      return (
        <div className="flex items-end justify-between gap-3">
          <div className="flex-1">
            <Label className="text-sm font-medium text-zinc-900">{label}</Label>
            {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
            <p className="mt-1 font-mono text-sm text-zinc-600">
              已設定 {field.state.preview ?? "••••••"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onReveal(true)}
            >
              <Eye className="mr-1 h-3.5 w-3.5" />
              修改
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(null)}
              className="text-red-600 hover:bg-red-50"
            >
              清除
            </Button>
          </div>
        </div>
      )
    }

    return (
      <div>
        <div className="flex items-baseline justify-between">
          <Label className="text-sm font-medium text-zinc-900">{label}</Label>
          {isEditing && (
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-700"
              onClick={() => {
                onReveal(false)
                onChange(undefined)
              }}
            >
              取消修改
            </button>
          )}
        </div>
        {hint && <p className="mb-1 text-xs text-zinc-500">{hint}</p>}
        <Input
          type="text"
          value={draftValue === null || draftValue === undefined ? "" : draftValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-sm"
          autoComplete="off"
        />
      </div>
    )
  }

  // ---- Plain text field ----
  const value = draftValue !== undefined ? (draftValue ?? "") : (field.state.value ?? "")
  return (
    <div>
      <Label className="text-sm font-medium text-zinc-900">{label}</Label>
      {hint && <p className="mb-1 text-xs text-zinc-500">{hint}</p>}
      <Input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  )
}

