import { createHmac, timingSafeEqual } from "crypto"

/**
 * Signed token for the "重新付款" (resume payment) link embedded in the
 * unpaid-order reminder email. Lets a guest (no login) re-open the payment
 * page for their own order without exposing any ability to pay OTHER orders.
 *
 * Secret: REPAY_TOKEN_SECRET if set, else the Supabase service-role key —
 * which is always present on BOTH the API (verifies the token) and the worker
 * (mints the token inside the reminder job), so the two never disagree.
 */
function secret(): string {
  return (
    process.env.REPAY_TOKEN_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "insecure-dev-secret"
  )
}

export function makeRepayToken(orderNumber: string): string {
  return createHmac("sha256", secret()).update(`repay:${orderNumber}`).digest("hex").slice(0, 32)
}

export function verifyRepayToken(orderNumber: string, token: string): boolean {
  const expected = makeRepayToken(orderNumber)
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}
