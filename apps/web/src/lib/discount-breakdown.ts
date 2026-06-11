/**
 * Turn an order row's stored discount fields into labeled display lines so
 * admins (and customers) can see WHY a discount applied, not just the total.
 *
 * Data sources (all already persisted at order creation, orders.ts):
 *   campaign_discount      — 行銷活動折扣金額
 *   metadata.coupon_*      — 優惠券代碼 + 折抵金額
 *   points_used            — 點數折抵（1 點 = NT$1）
 *   discount_amount        — 總折扣；扣掉上面三項的餘額即會員等級折扣
 */

export type DiscountLine = {
  key: "campaign" | "coupon" | "points" | "member" | "other"
  label: string
  amount: number
}

export type DiscountBreakdownInput = {
  discount_amount?: number | string | null
  campaign_discount?: number | string | null
  points_used?: number | string | null
  metadata?: {
    coupon_code?: string | null
    coupon_discount?: number | string | null
  } | null
  /** Resolved campaign names (from applied_campaign_ids), optional. */
  campaignNames?: string[]
  attributed_kol_slug?: string | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildDiscountBreakdown(input: DiscountBreakdownInput): DiscountLine[] {
  const total = round2(Number(input.discount_amount ?? 0))
  if (total <= 0) return []

  const campaign = round2(Number(input.campaign_discount ?? 0))
  const coupon = round2(Number(input.metadata?.coupon_discount ?? 0))
  const points = round2(Number(input.points_used ?? 0))

  const lines: DiscountLine[] = []

  if (campaign > 0) {
    const names = (input.campaignNames ?? []).filter(Boolean)
    lines.push({
      key: "campaign",
      label: names.length > 0 ? `行銷活動折扣（${names.join("、")}）` : "行銷活動折扣",
      amount: campaign,
    })
  }
  if (coupon > 0) {
    const code = input.metadata?.coupon_code
    const kol = input.attributed_kol_slug
    const suffix = code ? `（${code}${kol ? `・KOL：${kol}` : ""}）` : ""
    lines.push({ key: "coupon", label: `優惠券折扣${suffix}`, amount: coupon })
  }
  if (points > 0) {
    lines.push({ key: "points", label: `點數折抵（${points.toLocaleString()} 點）`, amount: points })
  }

  // Whatever the itemized parts don't account for is the member-tier discount
  // (the only component not stored as its own column).
  const member = round2(total - campaign - coupon - points)
  if (member > 0.009) {
    lines.push({ key: "member", label: "會員等級折扣", amount: member })
  }

  // Legacy orders predating the breakdown columns: fall back to a single line
  // so the math always adds up to discount_amount.
  if (lines.length === 0) {
    lines.push({ key: "other", label: "折扣", amount: total })
  }
  return lines
}
