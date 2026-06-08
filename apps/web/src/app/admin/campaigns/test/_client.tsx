"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { adminFetch } from "@/lib/admin-fetch"
import { API_URL } from "@/lib/api-url"

type Tier = { id: string; name: string; discount_rate: number; min_spend: number }
type ItemRow = { sku: string; qty: number; unitPrice?: number /* dollars, optional override */ }
type UserMode = "guest" | "impersonate" | "custom"

type CampaignResult = {
  campaign_id: string
  campaign_name: string
  type: string
  applied: boolean
  reason?: string
  discount_amount?: number
  free_items?: Array<{ sku?: string; name?: string; qty: number }>
  zero_shipping?: boolean
  rebate_multiplier?: number
  would_be_used?: boolean
  overridden_by_stacking?: boolean
}

type PreviewResponse = {
  data: {
    resolved_items: Array<{ variant_id: string; sku: string | null; name: string; unit_price_cents: number; qty: number }>
    breakdown: {
      subtotal: number
      shipping: number
      campaign_discount: number
      coupon_discount: number
      points_discount: number
      total: number
    }
    campaigns: CampaignResult[]
    applied_winners: Array<{ campaign_id: string; campaign_name: string; type: string }>
    coupon: null | { code: string; type: string; value: number; applied: boolean; reason?: string }
    ctx_summary: Record<string, unknown>
  }
}

const TYPE_LABELS: Record<string, string> = {
  discount: "折扣",
  freebie: "滿額贈品",
  points_multiplier: "點數倍率",
  free_shipping: "免運",
  bundle: "Bundle 組合",
  buy_x_get_y: "買X送Y",
  second_half_price: "第二件半價",
  spend_threshold: "滿額折扣",
  tier_upgrade_bonus: "升等獎勵",
  combo_discount: "任選折扣",
  birthday_bonus: "生日優惠",
  first_purchase: "首購",
}

export function TestBenchClient({ tiers }: { tiers: Tier[] }) {
  // ── Cart state ────────────────────────────────────────────────────────────
  const [items, setItems] = useState<ItemRow[]>([{ sku: "", qty: 1 }])

  // ── User context ──────────────────────────────────────────────────────────
  const [userMode, setUserMode] = useState<UserMode>("guest")
  const [impersonateEmail, setImpersonateEmail] = useState("")
  const [impersonateUserId, setImpersonateUserId] = useState<string | null>(null)
  const [impersonateError, setImpersonateError] = useState("")
  const [customTierId, setCustomTierId] = useState<string>("")
  const [customBirthday, setCustomBirthday] = useState<string>("")
  const [customHasPastOrders, setCustomHasPastOrders] = useState<boolean>(false)
  const [customCreatedAt, setCustomCreatedAt] = useState<string>("")

  // ── Shipping + extra promo ────────────────────────────────────────────────
  const [shippingMethod, setShippingMethod] = useState<"home_delivery" | "cvs_711" | "cvs_family" | "overseas_cod">("home_delivery")
  const [couponCode, setCouponCode] = useState("")
  const [pointsUsed, setPointsUsed] = useState("")

  // ── Run state ─────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PreviewResponse["data"] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRawJson, setShowRawJson] = useState(false)

  // Resolve impersonate email → user_id via /admin/customers/lookup
  useEffect(() => {
    if (userMode !== "impersonate" || !impersonateEmail.trim()) {
      setImpersonateUserId(null)
      setImpersonateError("")
      return
    }
    const handle = setTimeout(async () => {
      try {
        const res = await adminFetch(`${API_URL}/admin/customers/lookup?email=${encodeURIComponent(impersonateEmail.trim())}`)
        if (!res.ok) {
          setImpersonateUserId(null)
          setImpersonateError(res.status === 404 ? "查無此 user" : `查詢失敗 (${res.status})`)
          return
        }
        const body = (await res.json()) as { data?: { id: string; email: string } }
        if (body.data?.id) {
          setImpersonateUserId(body.data.id)
          setImpersonateError("")
        } else {
          setImpersonateUserId(null)
          setImpersonateError("查無此 user")
        }
      } catch {
        setImpersonateUserId(null)
        setImpersonateError("查詢錯誤")
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [userMode, impersonateEmail])

  function addItem() {
    setItems(arr => [...arr, { sku: "", qty: 1 }])
  }
  function removeItem(i: number) {
    setItems(arr => arr.filter((_, idx) => idx !== i))
  }
  function updateItem(i: number, patch: Partial<ItemRow>) {
    setItems(arr => arr.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function runSimulation() {
    setError(null)
    setLoading(true)
    setResult(null)
    try {
      const validItems = items
        .filter(r => r.sku.trim() && r.qty > 0)
        .map(r => ({
          sku: r.sku.trim(),
          qty: r.qty,
          ...(r.unitPrice !== undefined ? { unitPrice: Math.round(r.unitPrice * 100) } : {}),
        }))
      if (validItems.length === 0) {
        setError("請至少輸入 1 個 SKU + 數量")
        setLoading(false)
        return
      }

      const body: Record<string, unknown> = {
        items: validItems,
        shippingMethod,
      }

      if (userMode === "impersonate" && impersonateUserId) {
        body.user_id = impersonateUserId
      } else if (userMode === "custom") {
        if (customTierId) body.tier_id = customTierId
        if (customBirthday) body.birthday = customBirthday
        body.has_past_orders = customHasPastOrders
        if (customCreatedAt) body.user_created_at = new Date(customCreatedAt).toISOString()
        // For custom mode without impersonation, evaluator needs a non-empty user_id
        // for first_purchase check to fire — synth uuid keeps it consistent.
        body.user_id = "00000000-0000-0000-0000-000000000001"
      }

      if (couponCode.trim()) body.coupon_code = couponCode.trim()
      const pn = Number.parseInt(pointsUsed, 10)
      if (Number.isFinite(pn) && pn > 0) body.points_used = pn

      const res = await adminFetch(`${API_URL}/admin/campaigns/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError((err as { error?: string }).error ?? `HTTP ${res.status}`)
        return
      }
      const json = (await res.json()) as PreviewResponse
      setResult(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "執行錯誤")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-6">
      {/* ─────────────────── INPUT COLUMN ─────────────────── */}
      <div className="space-y-6">
        {/* Cart */}
        <section className="rounded-lg border bg-white p-4 space-y-3">
          <h2 className="font-semibold text-base">🛒 模擬購物車</h2>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
              <div>
                <Label className="text-xs">SKU</Label>
                <Input
                  value={it.sku}
                  onChange={e => updateItem(i, { sku: e.target.value })}
                  placeholder="RR-DF-PK-320"
                />
              </div>
              <div>
                <Label className="text-xs">數量</Label>
                <Input
                  type="number"
                  min={1}
                  value={it.qty}
                  onChange={e => updateItem(i, { qty: Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1) })}
                />
              </div>
              <div>
                <Label className="text-xs">單價覆寫 (NT$)</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="(DB)"
                  value={it.unitPrice ?? ""}
                  onChange={e => {
                    const v = e.target.value
                    updateItem(i, { unitPrice: v === "" ? undefined : Math.max(0, Number(v)) })
                  }}
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => removeItem(i)} disabled={items.length === 1}>
                ✕
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addItem}>+ 加商品</Button>
          <p className="text-xs text-zinc-500">SKU 反查 product_variants；找不到的 row 會在執行時被忽略</p>
        </section>

        {/* User context */}
        <section className="rounded-lg border bg-white p-4 space-y-3">
          <h2 className="font-semibold text-base">👤 使用者情境</h2>
          <div className="flex gap-2">
            {(["guest", "impersonate", "custom"] as UserMode[]).map(m => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={userMode === m ? "default" : "outline"}
                onClick={() => setUserMode(m)}
              >
                {m === "guest" ? "訪客" : m === "impersonate" ? "模擬登入" : "自訂"}
              </Button>
            ))}
          </div>

          {userMode === "guest" && (
            <p className="text-xs text-zinc-500">沒有 user_id — 首購、會員折扣、生日活動都不會啟用</p>
          )}

          {userMode === "impersonate" && (
            <div>
              <Label className="text-xs">使用者 Email</Label>
              <Input
                value={impersonateEmail}
                onChange={e => setImpersonateEmail(e.target.value)}
                placeholder="user@example.com"
              />
              {impersonateUserId && (
                <p className="text-xs text-emerald-600 mt-1">✓ 已找到 user_id {impersonateUserId.slice(0, 8)}…</p>
              )}
              {impersonateError && <p className="text-xs text-red-600 mt-1">{impersonateError}</p>}
            </div>
          )}

          {userMode === "custom" && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">會員等級</Label>
                <select
                  className="w-full rounded border border-zinc-200 px-3 py-2 text-sm"
                  value={customTierId}
                  onChange={e => setCustomTierId(e.target.value)}
                >
                  <option value="">（不指定）</option>
                  {tiers.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({Math.round(t.discount_rate * 100)}% off / 滿 NT$ {t.min_spend})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">生日 (YYYY-MM-DD)</Label>
                <Input
                  type="date"
                  value={customBirthday}
                  onChange={e => setCustomBirthday(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">註冊日期</Label>
                <Input
                  type="date"
                  value={customCreatedAt}
                  onChange={e => setCustomCreatedAt(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={customHasPastOrders}
                  onChange={e => setCustomHasPastOrders(e.target.checked)}
                />
                曾有已完成訂單（不是首購）
              </label>
            </div>
          )}
        </section>

        {/* Shipping + promo */}
        <section className="rounded-lg border bg-white p-4 space-y-3">
          <h2 className="font-semibold text-base">📦 運送 / 折抵</h2>
          <div>
            <Label className="text-xs">運送方式</Label>
            <select
              className="w-full rounded border border-zinc-200 px-3 py-2 text-sm"
              value={shippingMethod}
              onChange={e => setShippingMethod(e.target.value as typeof shippingMethod)}
            >
              <option value="home_delivery">宅配到府</option>
              <option value="cvs_711">7-11 取貨</option>
              <option value="cvs_family">全家取貨</option>
              <option value="overseas_cod">海外（到付）</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">優惠碼 (可選)</Label>
            <Input
              value={couponCode}
              onChange={e => setCouponCode(e.target.value)}
              placeholder="SUMMER100"
            />
          </div>
          <div>
            <Label className="text-xs">使用點數 (可選)</Label>
            <Input
              type="number"
              min={0}
              value={pointsUsed}
              onChange={e => setPointsUsed(e.target.value)}
              placeholder="50"
            />
          </div>
        </section>

        <Button
          type="button"
          onClick={runSimulation}
          disabled={loading || (userMode === "impersonate" && !impersonateUserId)}
          className="w-full"
          style={{ backgroundColor: "#10305a", color: "#fff" }}
        >
          {loading ? "執行中…" : "▶ 執行模擬"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {/* ─────────────────── RESULT COLUMN ─────────────────── */}
      <div className="space-y-4">
        {!result && (
          <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-zinc-400">
            填好左邊條件 → 按「執行模擬」看結果
          </div>
        )}
        {result && (
          <>
            {/* Breakdown card */}
            <section className="rounded-lg border bg-white p-4 space-y-1.5 text-sm">
              <h2 className="font-semibold text-base mb-2">💰 試算結果</h2>
              <div className="flex justify-between text-zinc-600">
                <span>商品小計</span>
                <span>NT$ {result.breakdown.subtotal.toLocaleString()}</span>
              </div>
              {result.breakdown.campaign_discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>活動折抵</span>
                  <span>- NT$ {result.breakdown.campaign_discount.toLocaleString()}</span>
                </div>
              )}
              {result.breakdown.coupon_discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>優惠碼折抵 ({result.coupon?.code})</span>
                  <span>- NT$ {result.breakdown.coupon_discount.toLocaleString()}</span>
                </div>
              )}
              {result.breakdown.points_discount > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>點數折抵</span>
                  <span>- NT$ {result.breakdown.points_discount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-zinc-600">
                <span>運費</span>
                <span>{result.breakdown.shipping === 0 ? "免運" : `NT$ ${result.breakdown.shipping.toLocaleString()}`}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-2 border-t" style={{ color: "#10305a" }}>
                <span>合計</span>
                <span>NT$ {result.breakdown.total.toLocaleString()}</span>
              </div>
              {result.coupon && !result.coupon.applied && (
                <p className="text-xs text-amber-700 mt-2">優惠碼 <strong>{result.coupon.code}</strong> 未套用：{result.coupon.reason}</p>
              )}
            </section>

            {/* Campaigns table */}
            <section className="rounded-lg border bg-white p-4">
              <h2 className="font-semibold text-base mb-3">📋 活動判定 ({result.campaigns.length} 個 active)</h2>
              {result.campaigns.length === 0 ? (
                <p className="text-sm text-zinc-500">目前沒有對此使用者啟用的活動。</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b text-xs text-zinc-500">
                      <tr>
                        <th className="text-left py-2 pr-2">活動名稱</th>
                        <th className="text-left py-2 pr-2">類型</th>
                        <th className="text-center py-2 pr-2">狀態</th>
                        <th className="text-right py-2 pr-2">折抵 / 贈品</th>
                        <th className="text-left py-2">說明</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.campaigns.map(c => (
                        <tr key={c.campaign_id} className="border-b last:border-0">
                          <td className="py-2 pr-2 font-medium">{c.campaign_name}</td>
                          <td className="py-2 pr-2 text-zinc-500">{TYPE_LABELS[c.type] ?? c.type}</td>
                          <td className="py-2 pr-2 text-center">
                            {c.would_be_used ? (
                              <span className="inline-block rounded bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs">✅ 套用</span>
                            ) : c.overridden_by_stacking ? (
                              <span className="inline-block rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-xs">⚠️ 被疊加規則蓋掉</span>
                            ) : (
                              <span className="inline-block rounded bg-zinc-100 text-zinc-600 px-2 py-0.5 text-xs">❌ 不適用</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right text-xs">
                            {c.applied && c.discount_amount ? `-NT$ ${c.discount_amount.toLocaleString()}` : null}
                            {c.applied && c.zero_shipping ? "免運" : null}
                            {c.applied && c.rebate_multiplier ? `${c.rebate_multiplier}× 點數` : null}
                            {c.applied && c.free_items && c.free_items.length > 0 && (
                              <span>{c.free_items.map(fi => `${fi.name ?? fi.sku} ×${fi.qty}`).join(", ")}</span>
                            )}
                          </td>
                          <td className="py-2 text-xs text-zinc-500">
                            {c.applied ? (c.overridden_by_stacking ? "同類型有更優選項" : "—") : (c.reason ?? "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Resolved items */}
            <section className="rounded-lg border bg-white p-4">
              <h2 className="font-semibold text-sm mb-2 text-zinc-600">已解析商品</h2>
              <ul className="text-xs text-zinc-500 space-y-0.5">
                {result.resolved_items.map(r => (
                  <li key={r.variant_id}>
                    {r.name} × {r.qty} @ NT$ {(r.unit_price_cents / 100).toLocaleString()} (SKU {r.sku ?? "—"})
                  </li>
                ))}
              </ul>
            </section>

            {/* Raw JSON */}
            <details className="rounded-lg border bg-white p-3 text-xs">
              <summary
                className="cursor-pointer text-zinc-600 select-none"
                onClick={() => setShowRawJson(!showRawJson)}
              >
                🔍 Raw evaluator JSON
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-zinc-50 p-3 text-[11px] leading-relaxed">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
