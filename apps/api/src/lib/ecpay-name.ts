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
