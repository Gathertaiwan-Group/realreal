/**
 * ECPay 超商取貨 (UNIMARTC2C / FAMIC2C) rejects the ReceiverName unless it is
 * either 2~5 Chinese characters OR 4~10 Latin letters — no digits, spaces or
 * symbols (error 10500036). This is the server-side safety net mirroring the
 * checkout guard in apps/web/src/lib/shipping-preview.ts (validateCvsReceiverName)
 * so a bypassed/buggy client can't create an order that then silently fails
 * logistics creation. Keep both copies in sync.
 *
 * 間隔號（·）is allowed for indigenous names. Returns an error message, or
 * undefined when the name is acceptable for CVS pickup.
 */
export function validateCvsReceiverName(raw: string): string | undefined {
  const n = (raw ?? "").trim()
  if (!n) return "請輸入收件人姓名"
  const pureChinese = /^[一-龥·‧]{2,5}$/.test(n)
  const pureEnglish = /^[A-Za-z]{4,10}$/.test(n)
  if (!pureChinese && !pureEnglish) {
    return "超商取貨姓名須為中文 2~5 字，或英文 4~10 字（不可含數字、空白或符號）"
  }
  return undefined
}

/**
 * Business rule (not an ECPay constraint): reject single-word nicknames like
 * "xuan" so the recipient name entered at checkout actually matches what's
 * on their ID — otherwise 超商取貨 pickup gets refused at the counter.
 * Accepts a Chinese name (2~5 字) or an English full name — either spaced
 * ("Xuan Chen") or joined ("XuanChen", needed for CVS pickup where ECPay
 * rejects spaces). Mirrored in apps/web/src/lib/shipping-preview.ts
 * (validateRealName) — change both together.
 */
export function validateRealName(raw: string): string | undefined {
  const n = (raw ?? "").trim()
  if (!n) return "請輸入收件人姓名"
  const pureChinese = /^[一-龥·‧]{2,5}$/.test(n)
  if (pureChinese) return undefined
  const spacedFullName = /^[A-Za-z]{2,}(?:\s[A-Za-z]{2,}){1,3}$/.test(n)
  const joinedFullName = /^(?:[A-Z][a-z]{1,9}){2,4}$/.test(n)
  if (spacedFullName || joinedFullName) return undefined
  return "請輸入完整真實姓名（例如：王小明 / Xuan Chen），須與證件相同以利取貨，不接受暱稱"
}
