"use client"

import { useState, useEffect, useCallback, useTransition } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { Trash2, Plus, X, Tag, Gift, Truck, Package, Star, Coins, Cake, TrendingUp } from "lucide-react"
import { adminFetch } from "@/lib/admin-fetch"
import { AdminTabs } from "../_components/AdminTabs"

const MARKETING_TABS = [
  { href: "/admin/campaigns", label: "行銷活動" },
  { href: "/admin/coupons", label: "優惠券" },
  { href: "/admin/marketing/tiers", label: "會員等級" },
  { href: "/admin/marketing/points", label: "點數規則" },
]

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Campaign {
  id: string
  name: string
  description: string | null
  tier_id: string | null
  type: string
  config: Record<string, unknown> | null
  coupon_id: string | null
  is_active: boolean
  starts_at: string
  ends_at: string | null
  created_at: string
  coupon?: { code: string } | null
  coupons?: { code: string } | null
  tier?: { name: string } | null
  membership_tiers?: { name: string } | null
}

interface MembershipTier {
  id: string
  name: string
}

type StatusKey = "all" | "active" | "scheduled" | "ended" | "disabled"

interface PreviewFreeItem {
  sku?: string
  product_id?: string
  qty: number
  name?: string
}

interface PreviewResult {
  campaign_id: string
  campaign_name: string
  type: string
  applied: boolean
  reason?: string
  discount_amount?: number
  free_items?: PreviewFreeItem[]
  rebate_multiplier?: number
  zero_shipping?: boolean
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const STATUS_TABS: { key: StatusKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "active", label: "進行中" },
  { key: "scheduled", label: "排程中" },
  { key: "ended", label: "已結束" },
  { key: "disabled", label: "停用" },
]

const TYPE_LABEL: Record<string, string> = {
  discount: "折扣",
  freebie: "滿額贈品",
  points_multiplier: "點數加倍",
  free_shipping: "免運",
  bundle: "組合優惠",
  buy_x_get_y: "買X送Y",
  second_half_price: "第二件優惠",
  spend_threshold: "滿額折扣",
  tier_upgrade_bonus: "升等加碼",
  combo_discount: "任選N件折扣",
  birthday_bonus: "生日當月優惠",
}

/* ---- Quick-import preset templates ---- */

interface PresetTemplate {
  name: string
  description: string
  type: string
  config: Record<string, unknown>
}

interface PresetCategory {
  key: string
  label: string
  Icon: typeof Tag
  templates: PresetTemplate[]
}

const PRESET_CATEGORIES: PresetCategory[] = [
  {
    key: "discount",
    label: "折扣",
    Icon: Tag,
    templates: [
      { name: "全館95折", description: "全站商品95折", type: "discount", config: { discount_method: "percent", discount_value: 5, scope: "all" } },
      { name: "任選3件88折", description: "全館任選3件88折", type: "combo_discount", config: { min_items: 3, discount_percent: 12, scope: "all", mix_match: true } },
      { name: "任選5件8折", description: "凍乾水果任選5件8折", type: "combo_discount", config: { min_items: 5, discount_percent: 20, scope: "specific_categories", category_slug: "freeze-dried", mix_match: true } },
      { name: "第二件半價", description: "全館第二件半價", type: "second_half_price", config: { discount_percent: 50, scope: "all", applies_to: "cheapest", max_pairs: 1 } },
      { name: "第二件6折", description: "蛋白粉第二件6折", type: "second_half_price", config: { discount_percent: 40, scope: "specific_categories", category_slug: "protein", applies_to: "cheapest", max_pairs: 1 } },
    ],
  },
  {
    key: "freebie",
    label: "贈品",
    Icon: Gift,
    templates: [
      { name: "滿額贈品 — 凍乾試吃包", description: "滿$1,500送試吃包", type: "freebie", config: { min_order_amount: 1500, gift_name: "凍乾水果試吃包", gift_sku: "RR-FD-SAMPLE", gift_qty: 1 } },
    ],
  },
  {
    key: "shipping",
    label: "運費",
    Icon: Truck,
    templates: [
      { name: "免運 — 滿$800", description: "滿800免運", type: "free_shipping", config: { min_order_amount: 800 } },
    ],
  },
  {
    key: "bundle",
    label: "組合",
    Icon: Package,
    templates: [
      { name: "買一送一 — 蛋白粉", description: "蛋白粉系列買一送一", type: "buy_x_get_y", config: { buy_quantity: 1, get_quantity: 1, scope: "specific_categories", category_slug: "protein", same_item_only: true, max_uses_per_order: 1 } },
      { name: "買三送二 — 凍乾水果", description: "凍乾水果買三送兩包", type: "buy_x_get_y", config: { buy_quantity: 3, get_quantity: 2, scope: "specific_categories", category_slug: "freeze-dried", same_item_only: false, free_item_rule: "lowest_price", max_uses_per_order: 1 } },
    ],
  },
  {
    key: "threshold",
    label: "滿額",
    Icon: Star,
    templates: [
      { name: "滿千折百", description: "訂單滿 $1,000 折 $100", type: "spend_threshold", config: { min_amount: 1000, discount_amount: 100, stackable: false } },
      { name: "滿 $2,000 折 $300", description: "滿兩千折三百，可疊加", type: "spend_threshold", config: { min_amount: 2000, discount_amount: 300, stackable: true } },
    ],
  },
  {
    key: "points",
    label: "點數",
    Icon: Coins,
    templates: [
      { name: "公益存款雙倍", description: "公益存款雙倍累積", type: "points_multiplier", config: { multiplier: 2, scope: "all" } },
    ],
  },
  {
    key: "birthday",
    label: "生日",
    Icon: Cake,
    templates: [
      { name: "生日當月 9 折 + 雙倍", description: "生日當月全館 9 折，公益存款 ×2", type: "birthday_bonus", config: { discount_method: "percent", discount_value: 10, rebate_multiplier: 2, birthday_window_days: 31 } },
      { name: "生日當月 95 折 + 1.5 倍", description: "生日當月全館 95 折，公益存款 ×1.5", type: "birthday_bonus", config: { discount_method: "percent", discount_value: 5, rebate_multiplier: 1.5, birthday_window_days: 31 } },
    ],
  },
  {
    key: "tier_upgrade",
    label: "升等",
    Icon: TrendingUp,
    templates: [
      { name: "升金卡贈 500 點", description: "升級至金卡會員贈送 500 公益存款", type: "tier_upgrade_bonus", config: { tier_slug: "gold", bonus_points: 500 } },
      { name: "升鑽石贈 1000 點", description: "升級至鑽石會員贈送 1000 公益存款", type: "tier_upgrade_bonus", config: { tier_slug: "diamond", bonus_points: 1000 } },
    ],
  },
]

const PRESET_TEMPLATES: PresetTemplate[] = PRESET_CATEGORIES.flatMap((g) => g.templates)

const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function campaignStatus(c: Campaign): {
  key: StatusKey
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
} {
  if (!c.is_active) return { key: "disabled", label: "停用", variant: "secondary" }
  const now = new Date()
  if (c.ends_at && new Date(c.ends_at) < now) return { key: "ended", label: "已結束", variant: "destructive" }
  if (new Date(c.starts_at) > now) return { key: "scheduled", label: "排程中", variant: "outline" }
  return { key: "active", label: "進行中", variant: "default" }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleDateString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit" })
}

function toLocalDatetime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ------------------------------------------------------------------ */
/*  Config fields per type                                             */
/* ------------------------------------------------------------------ */

function ConfigFields({ type, config, prefix }: { type: string; config: Record<string, unknown>; prefix: string }) {
  if (type === "discount") {
    return (
      <>
        <div className="space-y-1.5">
          <Label className="text-xs">折扣方式</Label>
          <select name={`${prefix}_discount_method`} defaultValue={(config.discount_method as string) ?? "percent"} className={selectClass}>
            <option value="percent">百分比</option>
            <option value="fixed">固定金額</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">折扣值</Label>
          <Input name={`${prefix}_discount_value`} type="number" min={0} defaultValue={(config.discount_value as number) ?? ""} placeholder="10" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">適用範圍</Label>
          <select name={`${prefix}_scope`} defaultValue={(config.scope as string) ?? "all"} className={selectClass}>
            <option value="all">全部商品</option>
            <option value="specific_categories">指定分類</option>
          </select>
        </div>
      </>
    )
  }

  if (type === "bundle" || type === "buy_x_get_y") {
    return (
      <>
        <div className="space-y-1.5">
          <Label className="text-xs">購買數量</Label>
          <Input name={`${prefix}_buy_quantity`} type="number" min={1} defaultValue={(config.buy_quantity as number) ?? ""} placeholder="3" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">贈送數量</Label>
          <Input name={`${prefix}_get_quantity`} type="number" min={1} defaultValue={((config.get_quantity ?? config.free_quantity) as number) ?? ""} placeholder="1" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">適用範圍</Label>
          <select name={`${prefix}_scope`} defaultValue={(config.scope as string) ?? "all"} className={selectClass}>
            <option value="all">全部商品</option>
            <option value="specific_categories">指定分類</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">指定分類 (slug)</Label>
          <Input name={`${prefix}_category_slug`} defaultValue={(config.category_slug as string) ?? ""} placeholder="protein" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">限同品項</Label>
          <select name={`${prefix}_same_item_only`} defaultValue={config.same_item_only ? "true" : "false"} className={selectClass}>
            <option value="true">是 — 同商品才送</option>
            <option value="false">否 — 可跨商品</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">贈品取價規則</Label>
          <select name={`${prefix}_free_item_rule`} defaultValue={(config.free_item_rule as string) ?? "lowest_price"} className={selectClass}>
            <option value="lowest_price">取最低價品</option>
            <option value="highest_price">取最高價品</option>
            <option value="same_item">同品項</option>
          </select>
        </div>
      </>
    )
  }

  if (type === "second_half_price") {
    return (
      <>
        <div className="space-y-1.5">
          <Label className="text-xs">第二件折扣 (%)</Label>
          <Input name={`${prefix}_discount_percent`} type="number" min={1} max={100} defaultValue={(config.discount_percent as number) ?? 50} placeholder="50" />
          <p className="text-[10px] text-zinc-400">50 = 半價，40 = 6折，0 = 免費</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">適用範圍</Label>
          <select name={`${prefix}_scope`} defaultValue={(config.scope as string) ?? "all"} className={selectClass}>
            <option value="all">全部商品</option>
            <option value="specific_categories">指定分類</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">指定分類 (slug)</Label>
          <Input name={`${prefix}_category_slug`} defaultValue={(config.category_slug as string) ?? ""} placeholder="protein" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">最多幾組</Label>
          <Input name={`${prefix}_max_pairs`} type="number" min={1} defaultValue={(config.max_pairs as number) ?? 1} placeholder="1" />
        </div>
      </>
    )
  }

  if (type === "spend_threshold") {
    return (
      <>
        <div className="space-y-1.5">
          <Label className="text-xs">最低消費金額 (NT$)</Label>
          <Input name={`${prefix}_min_amount`} type="number" min={0} defaultValue={(config.min_amount as number) ?? ""} placeholder="1000" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">折扣金額 (NT$)</Label>
          <Input name={`${prefix}_discount_amount`} type="number" min={0} defaultValue={(config.discount_amount as number) ?? ""} placeholder="100" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">可與會員折扣疊加</Label>
          <select name={`${prefix}_stackable`} defaultValue={config.stackable ? "true" : "false"} className={selectClass}>
            <option value="false">否</option>
            <option value="true">是</option>
          </select>
        </div>
      </>
    )
  }

  if (type === "combo_discount") {
    return (
      <>
        <div className="space-y-1.5">
          <Label className="text-xs">最少選購件數</Label>
          <Input name={`${prefix}_min_items`} type="number" min={2} defaultValue={(config.min_items as number) ?? ""} placeholder="3" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">折扣 (%)</Label>
          <Input name={`${prefix}_discount_percent`} type="number" min={1} max={99} defaultValue={(config.discount_percent as number) ?? ""} placeholder="12" />
          <p className="text-[10px] text-zinc-400">12 = 88折，20 = 8折</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">適用範圍</Label>
          <select name={`${prefix}_scope`} defaultValue={(config.scope as string) ?? "all"} className={selectClass}>
            <option value="all">全部商品</option>
            <option value="specific_categories">指定分類</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">指定分類 (slug)</Label>
          <Input name={`${prefix}_category_slug`} defaultValue={(config.category_slug as string) ?? ""} placeholder="" />
        </div>
      </>
    )
  }

  if (type === "freebie") {
    return (
      <>
        <div className="space-y-1.5">
          <Label className="text-xs">最低訂單金額 (NT$)</Label>
          <Input name={`${prefix}_min_order_amount`} type="number" min={0} defaultValue={(config.min_order_amount as number) ?? ""} placeholder="1500" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">贈品名稱</Label>
          <Input name={`${prefix}_gift_name`} defaultValue={(config.gift_name as string) ?? ""} placeholder="凍乾水果試吃包" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">贈品 SKU</Label>
          <Input name={`${prefix}_gift_sku`} defaultValue={(config.gift_sku as string) ?? ""} placeholder="RR-FD-SAMPLE" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">贈送數量</Label>
          <Input name={`${prefix}_gift_qty`} type="number" min={1} defaultValue={(config.gift_qty as number) ?? 1} placeholder="1" />
        </div>
      </>
    )
  }

  if (type === "free_shipping") {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">最低訂單金額 (NT$)</Label>
        <Input name={`${prefix}_min_order_amount`} type="number" min={0} defaultValue={(config.min_order_amount as number) ?? ""} placeholder="500" />
      </div>
    )
  }

  if (type === "points_multiplier") {
    return (
      <>
        <div className="space-y-1.5">
          <Label className="text-xs">倍率</Label>
          <Input name={`${prefix}_multiplier`} type="number" min={1} step={0.5} defaultValue={(config.multiplier as number) ?? 2} placeholder="2" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">適用範圍</Label>
          <select name={`${prefix}_scope`} defaultValue={(config.scope as string) ?? "all"} className={selectClass}>
            <option value="all">全部商品</option>
            <option value="specific_categories">指定分類</option>
          </select>
        </div>
      </>
    )
  }

  // default: raw JSON textarea
  return (
    <div className="space-y-1.5 sm:col-span-2 md:col-span-3">
      <Label className="text-xs">設定 (JSON)</Label>
      <textarea
        name={`${prefix}_raw_config`}
        rows={3}
        defaultValue={Object.keys(config).length > 0 ? JSON.stringify(config, null, 2) : ""}
        placeholder='{"key": "value"}'
        className={`${selectClass} font-mono text-xs`}
      />
    </div>
  )
}

function extractConfig(fd: FormData, prefix: string, type: string): Record<string, unknown> {
  if (type === "discount") {
    return {
      discount_method: fd.get(`${prefix}_discount_method`) as string,
      discount_value: Number(fd.get(`${prefix}_discount_value`)) || 0,
      scope: fd.get(`${prefix}_scope`) as string,
    }
  }
  if (type === "bundle" || type === "buy_x_get_y") {
    return {
      buy_quantity: Number(fd.get(`${prefix}_buy_quantity`)) || 1,
      get_quantity: Number(fd.get(`${prefix}_get_quantity`)) || 1,
      scope: fd.get(`${prefix}_scope`) as string,
      category_slug: (fd.get(`${prefix}_category_slug`) as string) || undefined,
      same_item_only: fd.get(`${prefix}_same_item_only`) === "true",
      free_item_rule: fd.get(`${prefix}_free_item_rule`) as string,
    }
  }
  if (type === "second_half_price") {
    return {
      discount_percent: Number(fd.get(`${prefix}_discount_percent`)) || 50,
      scope: fd.get(`${prefix}_scope`) as string,
      category_slug: (fd.get(`${prefix}_category_slug`) as string) || undefined,
      max_pairs: Number(fd.get(`${prefix}_max_pairs`)) || 1,
    }
  }
  if (type === "spend_threshold") {
    return {
      min_amount: Number(fd.get(`${prefix}_min_amount`)) || 0,
      discount_amount: Number(fd.get(`${prefix}_discount_amount`)) || 0,
      stackable: fd.get(`${prefix}_stackable`) === "true",
    }
  }
  if (type === "combo_discount") {
    return {
      min_items: Number(fd.get(`${prefix}_min_items`)) || 3,
      discount_percent: Number(fd.get(`${prefix}_discount_percent`)) || 0,
      scope: fd.get(`${prefix}_scope`) as string,
      category_slug: (fd.get(`${prefix}_category_slug`) as string) || undefined,
    }
  }
  if (type === "freebie") {
    return {
      min_order_amount: Number(fd.get(`${prefix}_min_order_amount`)) || 0,
      gift_name: (fd.get(`${prefix}_gift_name`) as string) || "",
      gift_sku: (fd.get(`${prefix}_gift_sku`) as string) || "",
      gift_qty: Number(fd.get(`${prefix}_gift_qty`)) || 1,
    }
  }
  if (type === "free_shipping") {
    return { min_order_amount: Number(fd.get(`${prefix}_min_order_amount`)) || 0 }
  }
  if (type === "points_multiplier") {
    return {
      multiplier: Number(fd.get(`${prefix}_multiplier`)) || 2,
      scope: fd.get(`${prefix}_scope`) as string,
    }
  }
  try {
    return JSON.parse((fd.get(`${prefix}_raw_config`) as string) || "{}")
  } catch {
    return {}
  }
}

/* ------------------------------------------------------------------ */
/*  Preview helpers                                                    */
/* ------------------------------------------------------------------ */

const DEFAULT_MOCK_CART = {
  items: [
    { product_id: "mock-1", variant_id: "mock-1-v", category_id: null, sku: "RR-PROTEIN-01", name: "蛋白粉", unit_price: 1000, qty: 2 },
    { product_id: "mock-2", variant_id: "mock-2-v", category_id: null, sku: "RR-FD-01", name: "凍乾水果", unit_price: 0, qty: 0 },
  ],
  subtotal: 2000,
  shipping_fee: 80,
}

const DEFAULT_MOCK_USER = { id: "preview", tier_id: null as string | null, birthday: null as string | null }

async function runPreview(type: string, config: Record<string, unknown>): Promise<PreviewResult | { error: string }> {
  try {
    const res = await adminFetch(`${API_URL}/admin/campaigns/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        config,
        mock_cart: DEFAULT_MOCK_CART,
        mock_user: DEFAULT_MOCK_USER,
      }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: body?.message ?? `預覽失敗 (HTTP ${res.status})` }
    }
    const json = await res.json()
    return (json.result ?? json) as PreviewResult
  } catch (err) {
    return { error: err instanceof Error ? err.message : "預覽失敗" }
  }
}

function PreviewBox({ result }: { result: PreviewResult | { error: string } | null }) {
  if (!result) return null
  if ("error" in result) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
        {result.error}
      </div>
    )
  }
  if (!result.applied) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 space-y-1">
        <p className="font-semibold">未套用</p>
        <p>{result.reason ?? "不符合套用條件"}</p>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 space-y-1">
      <p className="font-semibold">
        折抵 NT$ {(result.discount_amount ?? 0).toLocaleString()}
      </p>
      {result.zero_shipping && <p>含免運（運費歸零）</p>}
      {result.rebate_multiplier && result.rebate_multiplier !== 1 && (
        <p>公益存款倍率 ×{result.rebate_multiplier}</p>
      )}
      {result.free_items && result.free_items.length > 0 && (
        <div>
          <p>贈品：</p>
          <ul className="ml-4 list-disc">
            {result.free_items.map((f, i) => (
              <li key={`${f.sku ?? f.product_id ?? "item"}-${i}`}>
                {f.name ?? f.sku ?? f.product_id ?? "贈品"} × {f.qty}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Page component                                                     */
/* ------------------------------------------------------------------ */

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [tiers, setTiers] = useState<MembershipTier[]>([])
  const [tab, setTab] = useState<StatusKey>("all")
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [createType, setCreateType] = useState("discount")
  const [editType, setEditType] = useState("discount")
  const [isPending, startTransition] = useTransition()
  const [showPresets, setShowPresets] = useState(false)
  const [createPreview, setCreatePreview] = useState<PreviewResult | { error: string } | null>(null)
  const [editPreview, setEditPreview] = useState<PreviewResult | { error: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)

  function handlePreview(formId: string, type: string, target: "create" | "edit") {
    const form = document.getElementById(formId) as HTMLFormElement | null
    if (!form) return
    const fd = new FormData(form)
    const prefix = target === "create" ? "c" : "e"
    const config = extractConfig(fd, prefix, type)
    setPreviewing(true)
    const setter = target === "create" ? setCreatePreview : setEditPreview
    setter(null)
    runPreview(type, config).then((res) => {
      setter(res)
      setPreviewing(false)
    })
  }

  /* --- Quick Import Preset --- */

  function handleImportPreset(preset: PresetTemplate) {
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: preset.name,
            description: preset.description,
            type: preset.type,
            config: preset.config,
            is_active: false,
            starts_at: new Date().toISOString(),
            ends_at: null,
          }),
        })
        if (!res.ok) throw new Error("匯入失敗")
        toast.success(`已匯入「${preset.name}」`)
        await fetchCampaigns()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "匯入失敗")
      }
    })
  }

  function handleImportAll() {
    if (!confirm(`確定要匯入全部 ${PRESET_TEMPLATES.length} 個常用模板嗎？匯入後預設為停用狀態，您可以再行啟用。`)) return
    startTransition(async () => {
      let ok = 0, fail = 0
      for (const preset of PRESET_TEMPLATES) {
        try {
          const res = await adminFetch(`${API_URL}/admin/campaigns`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: preset.name,
              description: preset.description,
              type: preset.type,
              config: preset.config,
              is_active: false,
              starts_at: new Date().toISOString(),
              ends_at: null,
            }),
          })
          if (res.ok) ok++; else fail++
        } catch { fail++ }
      }
      toast.success(`已匯入 ${ok} 個模板${fail > 0 ? `，${fail} 個失敗` : ""}`)
      await fetchCampaigns()
      setShowPresets(false)
    })
  }

  /* --- Fetch --- */

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await adminFetch(`${API_URL}/admin/campaigns`)
      if (res.ok) {
        const json = await res.json()
        setCampaigns(json.campaigns ?? json.data ?? json ?? [])
      }
    } catch { /* API unavailable */ }
  }, [])

  const fetchTiers = useCallback(async () => {
    try {
      const res = await adminFetch(`${API_URL}/membership-tiers`)
      if (res.ok) {
        const json = await res.json()
        setTiers(json.data ?? json.tiers ?? json ?? [])
      }
    } catch { /* API unavailable */ }
  }, [])

  useEffect(() => {
    fetchCampaigns()
    fetchTiers()
  }, [fetchCampaigns, fetchTiers])

  const filtered = tab === "all" ? campaigns : campaigns.filter((c) => campaignStatus(c).key === tab)

  /* --- Create --- */

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const type = fd.get("type") as string
    const form = e.currentTarget

    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/campaigns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fd.get("name"),
            description: (fd.get("description") as string) || null,
            tier_id: (fd.get("tier_id") as string) || null,
            type,
            config: extractConfig(fd, "c", type),
            is_active: fd.get("is_active") === "on",
            starts_at: fd.get("starts_at"),
            ends_at: (fd.get("ends_at") as string) || null,
          }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "建立失敗")
        toast.success("活動已建立")
        form.reset()
        setShowCreate(false)
        setCreateType("discount")
        await fetchCampaigns()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "建立失敗")
      }
    })
  }

  /* --- Update --- */

  function handleUpdate(id: string, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const type = fd.get("type") as string

    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/campaigns/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fd.get("name"),
            description: (fd.get("description") as string) || null,
            tier_id: (fd.get("tier_id") as string) || null,
            type,
            config: extractConfig(fd, "e", type),
            is_active: fd.get("is_active") === "on",
            starts_at: fd.get("starts_at"),
            ends_at: (fd.get("ends_at") as string) || null,
          }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? "更新失敗")
        toast.success("活動已更新")
        setEditingId(null)
        await fetchCampaigns()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "更新失敗")
      }
    })
  }

  /* --- Delete --- */

  function handleDelete(id: string, name: string) {
    if (!confirm(`確定要刪除活動「${name}」嗎？此操作無法還原。`)) return
    startTransition(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/campaigns/${id}`, { method: "DELETE" })
        if (!res.ok) throw new Error("刪除失敗")
        toast.success("活動已刪除")
        await fetchCampaigns()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "刪除失敗")
      }
    })
  }

  /* --- Render --- */

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-2 text-xl font-semibold text-[#10305a]">行銷</h1>
        <AdminTabs tabs={MARKETING_TABS} />
      </div>

      {/* Create toggle / form */}
      {!showCreate ? (
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" />
          新增活動
        </Button>
      ) : (
        <form id="campaign-create-form" onSubmit={handleCreate} className="border rounded-lg bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">新增活動</h3>
            <button type="button" onClick={() => { setShowCreate(false); setCreatePreview(null) }} className="text-zinc-400 hover:text-zinc-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">活動名稱 *</Label>
              <Input name="name" required placeholder="夏季促銷" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">類型 *</Label>
              <select
                name="type"
                required
                value={createType}
                onChange={(e) => setCreateType(e.target.value)}
                className={selectClass}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">限定等級</Label>
              <select name="tier_id" className={selectClass}>
                <option value="">全部等級</option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">開始時間 *</Label>
              <Input name="starts_at" type="datetime-local" required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">結束時間（選填）</Label>
              <Input name="ends_at" type="datetime-local" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_active" defaultChecked className="rounded" />
                啟用
              </label>
            </div>
            <div className="sm:col-span-2 md:col-span-3 space-y-1.5">
              <Label className="text-xs">描述</Label>
              <textarea
                name="description"
                rows={2}
                placeholder="活動說明"
                className={selectClass}
              />
            </div>
            <ConfigFields type={createType} config={{}} prefix="c" />
          </div>
          <PreviewBox result={createPreview} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending}>{isPending ? "建立中..." : "建立"}</Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handlePreview("campaign-create-form", createType, "create")}
              disabled={isPending || previewing}
            >
              {previewing ? "計算中..." : "預覽折抵"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setShowCreate(false); setCreatePreview(null) }} disabled={isPending}>取消</Button>
          </div>
        </form>
      )}

      {/* Quick Import Presets */}
      {!showPresets ? (
        <Button size="sm" variant="outline" onClick={() => setShowPresets(true)}>
          匯入常用行銷模板
        </Button>
      ) : (
        <div className="border rounded-lg bg-white p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">常用行銷規則模板</h3>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleImportAll} disabled={isPending}>
                {isPending ? "匯入中..." : "全部匯入"}
              </Button>
              <button type="button" onClick={() => setShowPresets(false)} className="text-zinc-400 hover:text-zinc-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="space-y-5">
            {PRESET_CATEGORIES.map((group) => {
              const Icon = group.Icon
              return (
                <section key={group.key} className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#10305a]">
                    <Icon className="w-4 h-4" />
                    <span>{group.label}</span>
                    <span className="text-xs font-normal text-zinc-400">（{group.templates.length}）</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.templates.map((preset) => (
                      <div key={preset.name} className="border rounded-lg p-3 hover:bg-zinc-50 transition-colors">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-sm font-medium">{preset.name}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">{preset.description}</p>
                            <Badge variant="outline" className="mt-1.5 text-[10px]">{TYPE_LABEL[preset.type] ?? preset.type}</Badge>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs shrink-0"
                            onClick={() => handleImportPreset(preset)}
                            disabled={isPending}
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            匯入
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      {campaigns.length > 0 && (
        <div className="flex gap-4 text-sm text-zinc-500">
          <span>共 {campaigns.length} 項</span>
          <span>進行中 {campaigns.filter((c) => campaignStatus(c).key === "active").length}</span>
          <span>排程中 {campaigns.filter((c) => campaignStatus(c).key === "scheduled").length}</span>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 border-b">
        {STATUS_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? "border-[#10305a] text-[#10305a]"
                : "border-transparent text-zinc-400 hover:text-zinc-600"
            }`}
          >
            {label}
            {key !== "all" && (
              <span className="ml-1 text-xs">({campaigns.filter((c) => campaignStatus(c).key === key).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500 text-xs">
            <tr>
              <th className="px-4 py-3 text-left">活動名稱</th>
              <th className="px-4 py-3 text-left">類型</th>
              <th className="px-4 py-3 text-left">限定等級</th>
              <th className="px-4 py-3 text-center">狀態</th>
              <th className="px-4 py-3 text-left">活動期間</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-zinc-400">
                  暫無活動資料，點擊上方按鈕新增
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const status = campaignStatus(c)
                const isEditing = editingId === c.id

                if (isEditing) {
                  const editFormId = `campaign-edit-form-${c.id}`
                  return (
                    <tr key={c.id}>
                      <td colSpan={6} className="p-4 bg-zinc-50">
                        <form id={editFormId} onSubmit={(e) => handleUpdate(c.id, e)} className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold">編輯活動</h3>
                            <button type="button" onClick={() => { setEditingId(null); setEditPreview(null) }} className="text-zinc-400 hover:text-zinc-600">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                            <div className="space-y-1.5">
                              <Label className="text-xs">活動名稱 *</Label>
                              <Input name="name" required defaultValue={c.name} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">類型 *</Label>
                              <select
                                name="type"
                                required
                                value={editType}
                                onChange={(e) => setEditType(e.target.value)}
                                className={selectClass}
                              >
                                {TYPE_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">限定等級</Label>
                              <select name="tier_id" defaultValue={c.tier_id ?? ""} className={selectClass}>
                                <option value="">全部等級</option>
                                {tiers.map((t) => (
                                  <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">開始時間 *</Label>
                              <Input name="starts_at" type="datetime-local" required defaultValue={toLocalDatetime(c.starts_at)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">結束時間（選填）</Label>
                              <Input name="ends_at" type="datetime-local" defaultValue={toLocalDatetime(c.ends_at)} />
                            </div>
                            <div className="flex items-end pb-1">
                              <label className="flex items-center gap-2 text-sm">
                                <input type="checkbox" name="is_active" defaultChecked={c.is_active} className="rounded" />
                                啟用
                              </label>
                            </div>
                            <div className="sm:col-span-2 md:col-span-3 space-y-1.5">
                              <Label className="text-xs">描述</Label>
                              <textarea
                                name="description"
                                rows={2}
                                defaultValue={c.description ?? ""}
                                className={selectClass}
                              />
                            </div>
                            <ConfigFields type={editType} config={(c.config as Record<string, unknown>) ?? {}} prefix="e" />
                          </div>
                          <PreviewBox result={editPreview} />
                          <div className="flex gap-2">
                            <Button type="submit" size="sm" disabled={isPending}>{isPending ? "儲存中..." : "儲存"}</Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handlePreview(editFormId, editType, "edit")}
                              disabled={isPending || previewing}
                            >
                              {previewing ? "計算中..." : "預覽折抵"}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditPreview(null) }} disabled={isPending}>取消</Button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr
                    key={c.id}
                    className="hover:bg-zinc-50 cursor-pointer"
                    onClick={() => { setEditingId(c.id); setEditType(c.type); setEditPreview(null) }}
                  >
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{TYPE_LABEL[c.type] ?? c.type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {c.membership_tiers?.name ? (
                        <Badge variant="outline">{c.membership_tiers.name}</Badge>
                      ) : (
                        <span className="text-zinc-400">全部等級</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {fmtDate(c.starts_at)} ~ {fmtDate(c.ends_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(c.id, c.name) }}
                        className="p-1.5 rounded hover:bg-red-50 text-zinc-500 hover:text-red-600"
                        title="刪除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}