/**
 * 免運門檻的文案，只在這裡算一次。
 *
 * 這個檔案存在的原因是同一個 bug 犯了兩次。跑馬燈原本寫死「649 / 999」，後台
 * 實際設定是 650 / 1000，於是剛好 999 元的宅配客人被承諾免運、結帳被收 150。
 * 修好跑馬燈之後，FAQ 裡同一句話仍然寫死著 649 —— 因為那是另一個檔案，沒人
 * 想到它也在講同一件事。
 *
 * 後台改一個數字，兩個地方要一起變，唯一可靠的辦法是它們讀同一份資料、走同一
 * 段分組邏輯。文案語氣各自保留（跑馬燈講「999元」，FAQ 講「NT$999」），但
 * 「哪幾種寄送方式共用同一個門檻」這件事只有這裡說了算。
 */
import { API_URL } from "./api-url"

export type ShippingConfig = {
  cvs: { fee: number; free_threshold: number }
  cvsCod: { fee: number; free_threshold: number }
  home: { fee: number; free_threshold: number }
}

export type FreeShippingGroup = {
  threshold: number
  labels: string[]
  /** 三種寄送方式門檻都一樣 —— 講「全站」，不要把同一件事拆成三句。 */
  coversEveryMethod: boolean
}

export async function fetchShippingConfig(): Promise<ShippingConfig | null> {
  try {
    const res = await fetch(`${API_URL}/config`, { cache: "no-store" })
    if (!res.ok) return null
    const json = (await res.json()) as { shipping?: ShippingConfig | null }
    return json.shipping ?? null
  } catch {
    // 拿不到就回 null，呼叫端會省略免運那句話。短一點的文案沒關係，錯的數字不行。
    return null
  }
}

export function freeShippingGroups(s: ShippingConfig | null): FreeShippingGroup[] {
  if (!s) return []

  const methods = [
    { label: "超商取貨", threshold: s.cvs.free_threshold },
    { label: "超商取貨付款", threshold: s.cvsCod.free_threshold },
    { label: "宅配", threshold: s.home.free_threshold },
  ]

  // 依門檻分組，維持門檻第一次出現的順序。
  const groups = new Map<number, string[]>()
  for (const m of methods) {
    const bucket = groups.get(m.threshold)
    if (bucket) bucket.push(m.label)
    else groups.set(m.threshold, [m.label])
  }

  return Array.from(groups.entries()).map(([threshold, labels]) => ({
    threshold,
    labels,
    coversEveryMethod: labels.length === methods.length,
  }))
}

/** 跑馬燈用：短句，口語的「元」。 */
export function marqueeShippingMessages(s: ShippingConfig | null): string[] {
  return freeShippingGroups(s).map((g) =>
    g.coversEveryMethod
      ? `全站消費滿${g.threshold}元免運`
      : `${g.labels.join("、")}滿${g.threshold}元免運`,
  )
}

/** FAQ「運費如何計算？」的完整答案，含各方式運費與免運門檻。 */
export function shippingFeeAnswer(s: ShippingConfig | null): string {
  const overseas = "港澳寄送採順豐速運，運費到付，不適用滿額免運活動。"
  if (!s) return overseas

  const fees =
    `宅配運費 NT$${s.home.fee}，` +
    `超商取貨運費 NT$${s.cvs.fee}，` +
    `超商取貨付款運費 NT$${s.cvsCod.fee}。`

  const free = freeShippingGroups(s)
    .map((g) =>
      g.coversEveryMethod
        ? `全站消費滿 NT$${g.threshold} 免運。`
        : `消費滿 NT$${g.threshold} ${g.labels.join("、")}免運。`,
    )
    .join("")

  return `${fees}${free}${overseas}`
}
