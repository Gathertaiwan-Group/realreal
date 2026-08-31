/**
 * 發票載具格式驗證。
 *
 * 結帳頁原本完全不檢查載具號碼，所以客人可以選「自然人憑證」卻填手機條碼，
 * 訂單照樣成立 —— 失敗要等到幾天後 Amego 回「載具號碼不存在」才會發現，
 * 那時只能由人工去追（2026-08-31 訂單 #10000172 就是這樣卡住的）。
 * 在結帳當下擋下來，客人自己就會改對。
 *
 * 格式依財政部電子發票規範：
 *   手機條碼   /XXXXXXX  — 斜線 + 7 碼（大寫英數與 + - . ）
 *   自然人憑證 AB12345678901234 — 2 個大寫英文字母 + 14 位數字
 *   愛心碼     3–7 位數字
 */

const PHONE_CARRIER = /^\/[0-9A-Z+\-.]{7}$/
const NATURAL_PERSON = /^[A-Z]{2}\d{14}$/
const LOVE_CODE = /^\d{3,7}$/

export function validateCarrierNumber(
  carrierType: "phone" | "natural_person" | undefined,
  raw: string | undefined,
): string | null {
  const value = (raw ?? "").trim()
  if (!value) return "請輸入載具號碼"

  if (carrierType === "natural_person") {
    if (NATURAL_PERSON.test(value)) return null
    // The commonest real mistake: a 手機條碼 typed under 自然人憑證. Say so
    // explicitly instead of a generic format complaint — the fix is usually to
    // switch the radio button, not to retype the number.
    if (PHONE_CARRIER.test(value)) {
      return "這是手機條碼，請將載具類型改選「手機條碼」"
    }
    return "自然人憑證格式不正確（2 個大寫英文字母 + 14 位數字）"
  }

  // default: phone
  if (PHONE_CARRIER.test(value)) return null
  if (NATURAL_PERSON.test(value)) {
    return "這是自然人憑證，請將載具類型改選「自然人憑證」"
  }
  return "手機條碼格式不正確（斜線開頭共 8 碼，例如 /ABC1234）"
}

export function validateLoveCode(raw: string | undefined): string | null {
  const value = (raw ?? "").trim()
  if (!value) return "請輸入愛心碼"
  return LOVE_CODE.test(value) ? null : "愛心碼格式不正確（3–7 位數字）"
}

/** 統一編號：8 位數字。 */
export function validateTaxId(raw: string | undefined): string | null {
  const value = (raw ?? "").trim()
  if (!value) return "請輸入統一編號"
  return /^\d{8}$/.test(value) ? null : "統一編號格式不正確（8 位數字）"
}

/** 回傳整張發票設定的第一個錯誤，沒有錯誤則為 null。 */
export function validateInvoice(inv: {
  type: "B2C_2" | "B2C_3" | "B2B"
  carrierType?: "phone" | "natural_person" | "love_code"
  carrierNumber?: string
  loveCode?: string
  taxId?: string
}): string | null {
  if (inv.type === "B2C_3") {
    if (inv.carrierType === "love_code") return validateLoveCode(inv.loveCode)
    return validateCarrierNumber(inv.carrierType ?? "phone", inv.carrierNumber)
  }
  if (inv.type === "B2B") return validateTaxId(inv.taxId)
  return null
}
