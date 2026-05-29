"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { adminFetch } from "@/lib/admin-fetch"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const BENEFIT_OPTIONS = [
  { key: "free_shipping", label: "免運費" },
  { key: "birthday_coupon", label: "生日優惠券" },
  { key: "early_access", label: "搶先購買" },
  { key: "points_multiplier", label: "點數加倍" },
  { key: "vip_support", label: "VIP 客服" },
] as const

type BenefitKey = (typeof BENEFIT_OPTIONS)[number]["key"]

interface Tier {
  id: string
  name: string
  min_spend: number
  discount_rate: number
  sort_order: number
  benefits: BenefitKey[]
}

interface TierDistributionRow {
  tier_name: string
  member_count: number
  percentage: number
}

interface TopCustomerRow {
  display_name: string | null
  total_spend: number
  tier_name: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

const TIER_BADGE_CLASSES: Record<string, string> = {
  一般會員: "bg-zinc-200 text-zinc-700",
  銀卡會員: "bg-slate-300 text-slate-800",
  金卡會員: "bg-amber-400 text-amber-900",
  鑽石會員: "bg-sky-400 text-sky-900",
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Tab = "tiers" | "analytics" | "benefits"

const TABS: { key: Tab; label: string }[] = [
  { key: "tiers", label: "等級設定" },
  { key: "analytics", label: "會員分析" },
  { key: "benefits", label: "等級權益說明" },
]

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function AdminMembershipPage() {
  const [activeTab, setActiveTab] = useState<Tab>("tiers")

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-[#10305a]">會員管理</h1>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-[10px] bg-[#10305a]/5 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-[8px] px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-[#10305a] text-white shadow-sm"
                : "text-[#687279] hover:text-[#10305a]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "tiers" && <TierSettingsTab />}
      {activeTab === "analytics" && <AnalyticsTab />}
      {activeTab === "benefits" && <BenefitsTab />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 1 — 等級設定
// ---------------------------------------------------------------------------

function TierSettingsTab() {
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<Tier>>({})
  const [showNewForm, setShowNewForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const fetchTiers = useCallback(async () => {
    try {
      const res = await adminFetch(`${API_URL}/membership-tiers`, {})
      if (res.ok) {
        const data = await res.json()
        setTiers(Array.isArray(data) ? data : data.data ?? [])
      }
    } catch {
      toast.error("無法載入等級資料")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTiers()
  }, [fetchTiers])

  function startEdit(tier: Tier) {
    setEditingId(tier.id)
    setEditValues({ ...tier })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValues({})
  }

  async function saveEdit(tierId: string) {
    setSaving(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/membership-tiers/${tierId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editValues),
      })
      if (!res.ok) throw new Error()
      toast.success("已儲存")
      setEditingId(null)
      setEditValues({})
      await fetchTiers()
    } catch {
      toast.error("儲存失敗")
    } finally {
      setSaving(false)
    }
  }

  async function deleteTier(tierId: string) {
    if (!confirm("確定要刪除此等級？")) return
    try {
      const res = await adminFetch(`${API_URL}/admin/membership-tiers/${tierId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error()
      toast.success("已刪除")
      await fetchTiers()
    } catch {
      toast.error("刪除失敗")
    }
  }

  function toggleEditBenefit(key: BenefitKey) {
    setEditValues((prev) => {
      const current = prev.benefits ?? []
      return {
        ...prev,
        benefits: current.includes(key)
          ? current.filter((b) => b !== key)
          : [...current, key],
      }
    })
  }

  if (loading) {
    return <p className="text-sm text-[#687279]">載入中...</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#687279]">共 {tiers.length} 個等級</p>
        <Button
          onClick={() => setShowNewForm(true)}
          className="bg-[#10305a] hover:bg-[#10305a]/90 rounded-[10px]"
        >
          新增等級
        </Button>
      </div>

      {showNewForm && (
        <NewTierForm
          onClose={() => setShowNewForm(false)}
          onCreated={() => {
            setShowNewForm(false)
            fetchTiers()
          }}
        />
      )}

      {/* Tiers table */}
      <Card className="rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#10305a]/5">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">排序</th>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">名稱</th>
                <th className="text-right px-4 py-3 font-medium text-[#10305a]">最低消費</th>
                <th className="text-right px-4 py-3 font-medium text-[#10305a]">折扣率</th>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">權益</th>
                <th className="text-right px-4 py-3 font-medium text-[#10305a]">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tiers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#687279]">
                    尚未建立任何等級
                  </td>
                </tr>
              ) : (
                tiers.map((tier) => {
                  const isEditing = editingId === tier.id
                  return (
                    <tr key={tier.id} className="hover:bg-[#fffeee]/40">
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <Input
                            type="number"
                            className="w-16 h-8 text-sm rounded-[8px]"
                            value={editValues.sort_order ?? 0}
                            onChange={(e) =>
                              setEditValues((v) => ({ ...v, sort_order: Number(e.target.value) }))
                            }
                          />
                        ) : (
                          <span className="text-[#687279]">{tier.sort_order}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {isEditing ? (
                          <Input
                            className="w-32 h-8 text-sm rounded-[8px]"
                            value={editValues.name ?? ""}
                            onChange={(e) =>
                              setEditValues((v) => ({ ...v, name: e.target.value }))
                            }
                          />
                        ) : (
                          <span className="text-[#10305a]">{tier.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            className="w-28 h-8 text-sm rounded-[8px] ml-auto"
                            value={editValues.min_spend ?? 0}
                            onChange={(e) =>
                              setEditValues((v) => ({ ...v, min_spend: Number(e.target.value) }))
                            }
                          />
                        ) : (
                          <span className="text-[#687279]">NT$ {tier.min_spend.toLocaleString()}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max="1"
                            className="w-20 h-8 text-sm rounded-[8px] ml-auto"
                            value={editValues.discount_rate ?? 0}
                            onChange={(e) =>
                              setEditValues((v) => ({
                                ...v,
                                discount_rate: Number(e.target.value),
                              }))
                            }
                          />
                        ) : (
                          <span className="text-[#687279]">
                            {(tier.discount_rate * 100).toFixed(0)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            {BENEFIT_OPTIONS.map((b) => (
                              <label
                                key={b.key}
                                className="flex items-center gap-1 text-xs cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 rounded accent-[#10305a]"
                                  checked={editValues.benefits?.includes(b.key) ?? false}
                                  onChange={() => toggleEditBenefit(b.key)}
                                />
                                {b.label}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {(tier.benefits ?? []).map((b) => {
                              const opt = BENEFIT_OPTIONS.find((o) => o.key === b)
                              return (
                                <Badge
                                  key={b}
                                  className="bg-[#10305a]/10 text-[#10305a] text-xs font-normal"
                                >
                                  {opt?.label ?? b}
                                </Badge>
                              )
                            })}
                            {(!tier.benefits || tier.benefits.length === 0) && (
                              <span className="text-xs text-[#687279]">—</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                size="sm"
                                disabled={saving}
                                onClick={() => saveEdit(tier.id)}
                                className="bg-[#10305a] hover:bg-[#10305a]/90 rounded-[8px] text-xs"
                              >
                                {saving ? "儲存中..." : "儲存"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={cancelEdit}
                                className="text-xs"
                              >
                                取消
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => startEdit(tier)}
                                className="rounded-[8px] text-xs border-[#10305a]/20 text-[#10305a]"
                              >
                                編輯
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => deleteTier(tier.id)}
                                className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                              >
                                刪除
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New Tier Form
// ---------------------------------------------------------------------------

function NewTierForm({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState("")
  const [minSpend, setMinSpend] = useState(0)
  const [discountRate, setDiscountRate] = useState(0)
  const [sortOrder, setSortOrder] = useState(0)
  const [benefits, setBenefits] = useState<BenefitKey[]>([])
  const [saving, setSaving] = useState(false)

  function toggleBenefit(key: BenefitKey) {
    setBenefits((prev) =>
      prev.includes(key) ? prev.filter((b) => b !== key) : [...prev, key],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast.error("請輸入等級名稱")
      return
    }
    setSaving(true)
    try {
      const res = await adminFetch(`${API_URL}/admin/membership-tiers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          min_spend: minSpend,
          discount_rate: discountRate,
          sort_order: sortOrder,
          benefits,
        }),
      })
      if (!res.ok) throw new Error()
      toast.success("新增成功")
      onCreated()
    } catch {
      toast.error("新增失敗")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="rounded-[10px] border-[#10305a]/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-[#10305a]">新增等級</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#687279]">名稱</Label>
              <Input
                className="rounded-[8px]"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：金卡會員"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#687279]">最低消費 (NT$)</Label>
              <Input
                type="number"
                className="rounded-[8px]"
                value={minSpend}
                onChange={(e) => setMinSpend(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#687279]">折扣率 (0-1)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                className="rounded-[8px]"
                value={discountRate}
                onChange={(e) => setDiscountRate(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#687279]">排序</Label>
              <Input
                type="number"
                className="rounded-[8px]"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-[#687279]">權益</Label>
            <div className="flex flex-wrap gap-4">
              {BENEFIT_OPTIONS.map((b) => (
                <label key={b.key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded accent-[#10305a]"
                    checked={benefits.includes(b.key)}
                    onChange={() => toggleBenefit(b.key)}
                  />
                  {b.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={saving}
              className="bg-[#10305a] hover:bg-[#10305a]/90 rounded-[10px]"
            >
              {saving ? "新增中..." : "確認新增"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="rounded-[10px]"
            >
              取消
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Tab 2 — 會員分析
// ---------------------------------------------------------------------------

function AnalyticsTab() {
  const [tierDistribution, setTierDistribution] = useState<TierDistributionRow[]>([])
  const [topCustomers, setTopCustomers] = useState<TopCustomerRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAnalytics() {
      try {
        const res = await adminFetch(`${API_URL}/admin/analytics/membership`, {
        })
        if (res.ok) {
          const data = await res.json()
          setTierDistribution(data.tier_distribution ?? [])
          setTopCustomers(data.top_customers ?? [])
        }
      } catch {
        toast.error("無法載入分析資料")
      } finally {
        setLoading(false)
      }
    }
    fetchAnalytics()
  }, [])

  if (loading) {
    return <p className="text-sm text-[#687279]">載入中...</p>
  }

  return (
    <div className="space-y-6">
      {/* Tier Distribution */}
      <Card className="rounded-[10px]">
        <CardHeader>
          <CardTitle className="text-sm text-[#10305a]">等級分佈</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-[#10305a]/5">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">等級</th>
                <th className="text-right px-4 py-3 font-medium text-[#10305a]">人數</th>
                <th className="text-right px-4 py-3 font-medium text-[#10305a]">佔比</th>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">分佈</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tierDistribution.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[#687279]">
                    暫無資料
                  </td>
                </tr>
              ) : (
                tierDistribution.map((row) => {
                  const badgeClass =
                    TIER_BADGE_CLASSES[row.tier_name] ?? "bg-zinc-200 text-zinc-700"
                  return (
                    <tr key={row.tier_name} className="hover:bg-[#fffeee]/40">
                      <td className="px-4 py-3">
                        <Badge className={badgeClass}>{row.tier_name}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {row.member_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-[#687279]">
                        {row.percentage.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3">
                        <div className="h-2 w-full max-w-[200px] rounded-full bg-[#10305a]/10">
                          <div
                            className="h-2 rounded-full bg-[#10305a]"
                            style={{ width: `${Math.min(row.percentage, 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Top 10 Customers */}
      <Card className="rounded-[10px]">
        <CardHeader>
          <CardTitle className="text-sm text-[#10305a]">消費前 10 名會員</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-[#10305a]/5">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">排名</th>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">姓名</th>
                <th className="text-right px-4 py-3 font-medium text-[#10305a]">累計消費</th>
                <th className="text-left px-4 py-3 font-medium text-[#10305a]">等級</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {topCustomers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[#687279]">
                    暫無資料
                  </td>
                </tr>
              ) : (
                topCustomers.map((customer, idx) => {
                  const tierName = customer.tier_name ?? "一般會員"
                  const badgeClass =
                    TIER_BADGE_CLASSES[tierName] ?? "bg-zinc-200 text-zinc-700"
                  return (
                    <tr key={idx} className="hover:bg-[#fffeee]/40">
                      <td className="px-4 py-3 text-[#687279]">{idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-[#10305a]">
                        {customer.display_name ?? "（未設定）"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        NT${customer.total_spend.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={badgeClass}>{tierName}</Badge>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab 3 — 等級權益說明
// ---------------------------------------------------------------------------

function BenefitsTab() {
  const [tiers, setTiers] = useState<Tier[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchTiers() {
      try {
        const res = await adminFetch(`${API_URL}/membership-tiers`, {})
        if (res.ok) {
          const data = await res.json()
          setTiers(Array.isArray(data) ? data : data.data ?? [])
        }
      } catch {
        toast.error("無法載入等級資料")
      } finally {
        setLoading(false)
      }
    }
    fetchTiers()
  }, [])

  if (loading) {
    return <p className="text-sm text-[#687279]">載入中...</p>
  }

  if (tiers.length === 0) {
    return (
      <p className="text-sm text-[#687279]">尚未建立任何等級，請先至「等級設定」新增。</p>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tiers.map((tier) => {
        const badgeClass =
          TIER_BADGE_CLASSES[tier.name] ?? "bg-[#10305a]/10 text-[#10305a]"
        return (
          <Card
            key={tier.id}
            className="rounded-[10px] border-[#10305a]/10 flex flex-col"
          >
            <CardHeader className="pb-2 text-center">
              <Badge className={`${badgeClass} mx-auto mb-2 text-sm px-3 py-1`}>
                {tier.name}
              </Badge>
              <p className="text-2xl font-bold text-[#10305a]">
                {(tier.discount_rate * 100).toFixed(0)}%
                <span className="text-xs font-normal text-[#687279] ml-1">折扣</span>
              </p>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <p className="text-xs text-[#687279] text-center mb-4">
                最低消費 NT$ {tier.min_spend.toLocaleString()}
              </p>
              <div className="border-t border-[#10305a]/10 pt-3 space-y-2 flex-1">
                {BENEFIT_OPTIONS.map((b) => {
                  const has = tier.benefits?.includes(b.key) ?? false
                  return (
                    <div key={b.key} className="flex items-center gap-2 text-sm">
                      {has ? (
                        <span className="text-green-600 font-bold text-base leading-none">
                          &#10003;
                        </span>
                      ) : (
                        <span className="text-zinc-300 font-bold text-base leading-none">
                          &#10005;
                        </span>
                      )}
                      <span className={has ? "text-[#10305a]" : "text-zinc-400"}>
                        {b.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}