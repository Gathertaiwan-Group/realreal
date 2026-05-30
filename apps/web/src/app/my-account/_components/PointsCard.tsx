"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Public points card on /my-account.
 *
 * Renders current balance + 30-day expiring warning, and an inline-expanding
 * "看點數歷史 →" section showing the latest 20 ledger entries fetched from
 * the API (`/points/balance`, `/points/ledger?limit=20`).
 *
 * Spec: docs/superpowers/specs/2026-05-30-points-tiers-customer-detail-design.md
 * Section 5 — 顧客端 UI / `/my-account/page.tsx`.
 */

export interface PointsLedgerRow {
  id: string
  delta: number
  source:
    | "earn"
    | "redeem"
    | "expire"
    | "refund"
    | "manual_adjust"
    | "promo"
  source_ref_id: string | null
  note: string | null
  expires_at: string | null
  created_at: string
}

interface PointsCardProps {
  balance: number
  expiringSoon: number
  ledger: PointsLedgerRow[]
}

// Centralised source-code → 中文 translation (kept in sync with spec).
const SOURCE_LABELS: Record<PointsLedgerRow["source"], string> = {
  earn: "消費回饋",
  redeem: "折抵消費",
  expire: "過期",
  refund: "退款返還",
  manual_adjust: "手動調整",
  promo: "活動贈點",
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("zh-TW")
}

export function PointsCard({ balance, expiringSoon, ledger }: PointsCardProps) {
  const [open, setOpen] = useState(false)
  // Balance can technically dip below 0 after refunds (see spec "Known caveats");
  // shield the UI but keep raw data available for audit.
  const displayBalance = Math.max(0, balance)

  return (
    <section className="mb-10">
      <div className="overflow-hidden rounded-2xl border border-[#10305a]/10 bg-white">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#10305a]/10 text-[#10305a]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-[#687279]">
                公益點數
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#10305a]">
                {displayBalance.toLocaleString()}{" "}
                <span className="text-base font-normal text-[#687279]">
                  點 (= NT$ {displayBalance.toLocaleString()})
                </span>
              </p>
              {expiringSoon > 0 && (
                <p className="mt-1 text-sm font-medium text-orange-500">
                  🟡 30 天內過期：{expiringSoon.toLocaleString()} 點
                </p>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0"
            aria-expanded={open}
          >
            {open ? (
              <>
                <ChevronDown className="h-4 w-4" />
                收合
              </>
            ) : (
              <>
                看點數歷史
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        {open && (
          <div className="border-t border-zinc-100">
            {ledger.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-500">
                還沒有點數紀錄
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-[#687279]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">時間</th>
                      <th className="px-4 py-3 text-right font-medium">變動</th>
                      <th className="px-4 py-3 text-left font-medium">來源</th>
                      <th className="px-4 py-3 text-left font-medium">備註</th>
                      <th className="px-4 py-3 text-left font-medium">過期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((row, i) => {
                      const positive = row.delta > 0
                      return (
                        <tr
                          key={row.id}
                          className={i > 0 ? "border-t border-zinc-100" : ""}
                        >
                          <td className="px-4 py-3 text-zinc-600">
                            {formatDateTime(row.created_at)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono font-medium ${
                              positive
                                ? "text-emerald-600"
                                : "text-rose-600"
                            }`}
                          >
                            {positive ? "+" : ""}
                            {row.delta.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-[#10305a]">
                            {SOURCE_LABELS[row.source] ?? row.source}
                          </td>
                          <td className="px-4 py-3 text-zinc-500">
                            {row.note ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-zinc-500">
                            {row.source === "earn"
                              ? formatDate(row.expires_at)
                              : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
