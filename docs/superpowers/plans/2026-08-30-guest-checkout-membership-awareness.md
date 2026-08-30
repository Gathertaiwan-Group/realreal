# Guest Checkout Membership Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop guest customers from checking out without realizing it, and give guest orders a second and third chance to become member orders — via a checkout-page reminder card and a "加入會員" CTA on the order confirmation emails.

**Architecture:** A small stateless card component (`MemberReminderCard`) rendered on `/checkout` only when the visitor isn't logged in, plus a shared HTML-snippet helper (`renderMembershipCta`) reused by both of the two independent order-confirmation email send paths (`PaymentConfirmed.ts` for online-paid orders, the inline template in `notifyOrderPlacedCod` for CVS COD orders), gated on `!order.user_id`. Both CTAs point back to the existing `/checkout/confirm?order=<n>` page, which already renders the tested, shipped `GuestRegisterCard` one-click register-from-guest flow — no new backend route.

**Tech Stack:** Next.js 16 (`apps/web`), Express (`apps/api`), Vitest + Testing Library for both.

**Spec:** `docs/superpowers/specs/2026-08-30-guest-checkout-membership-awareness-design.md`

---

## Task 0: Pre-flight — confirm no `site_contents` override on the guest-order email path

Verified once already during planning (2026-08-30, empty result) but re-check before touching code, since `site_contents` can change between planning and execution — see `email-template-db-override` risk noted in the spec.

- [ ] **Step 1: Query `site_contents` for any `email_*` template rows**

Run (uses the service-role key already in `apps/api/.env`):

```bash
cd "apps/api" && node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
supabase.from('site_contents').select('key,updated_at').like('key', 'email_%').then(({ data, error }) => {
  console.log(JSON.stringify({ data, error }, null, 2));
});
"
```

Expected: `"data": []` (or, if any rows exist, none of them is `email_payment_confirmed`). If `email_payment_confirmed` DOES exist, stop and ask the user whether to edit that DB row directly or delete it so the code path (this plan's Task 3) takes effect — do not proceed with Task 3 silently, the membership CTA would never reach real customers.

`notifyOrderPlacedCod` (Task 4) has no DB-override risk — it sends raw HTML directly via `sendEmail()`, never through `site_contents`.

---

## Task 1: Checkout page member reminder card

**Files:**
- Create: `apps/web/src/components/checkout/MemberReminderCard.tsx`
- Modify: `apps/web/src/app/checkout/page.tsx`
- Test: `apps/web/src/app/checkout/__tests__/page.test.tsx`

- [ ] **Step 1: Extend the checkout page test file's mocks so a test can control logged-in state**

The existing test file mocks `@/lib/supabase/client` with a fixed `getUser` that always resolves to a guest. Rewrite the top of `apps/web/src/app/checkout/__tests__/page.test.tsx` (everything before the first `describe`) to:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CheckoutPage from "../page"
import { useCart } from "@/lib/cart"

const replaceMock = vi.fn()
const pushMock = vi.fn()
let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParams,
}))

const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } })

// Chainable Supabase query-builder stub: every method returns itself so any
// .select().eq().order().limit() combination in the page's profile/address
// prefill effect works, and it resolves to { data: null } whether awaited
// directly (the real query builder is thenable) or terminated with
// .maybeSingle()/.single().
function makeSupabaseChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = vi.fn(self)
  chain.eq = vi.fn(self)
  chain.in = vi.fn(self)
  chain.order = vi.fn(self)
  chain.limit = vi.fn(self)
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null }))
  chain.single = vi.fn(() => Promise.resolve({ data: null }))
  chain.then = (resolve: (v: { data: null }) => void) => resolve({ data: null })
  return chain
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn(() => makeSupabaseChain()),
  }),
}))

vi.mock("@/lib/user-addresses", () => ({
  listUserAddresses: vi.fn().mockResolvedValue([]),
  migrateLegacyAddresses: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))
```

Keep the rest of the file (the existing `describe("CheckoutPage CVS map return", ...)` block) exactly as-is below this.

- [ ] **Step 2: Write the two failing tests**

Append a new `describe` block at the end of `apps/web/src/app/checkout/__tests__/page.test.tsx`:

```tsx
describe("CheckoutPage member reminder card", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    searchParams = new URLSearchParams()
    useCart.setState({
      items: [
        {
          variantId: "variant-1",
          productName: "植物蛋白",
          variantName: "原味",
          price: 100,
          qty: 1,
        },
      ],
    })
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
    window.history.replaceState = vi.fn()
  })

  it("shows the reminder card for a logged-out visitor", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    render(<CheckoutPage />)

    await waitFor(() => {
      expect(screen.getByText("已經是會員了嗎？", { exact: false })).toBeInTheDocument()
    })
  })

  it("hides the reminder card once logged in", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "member@example.com" } },
    })

    render(<CheckoutPage />)

    // The auth effect prefills the email field synchronously alongside
    // flipping isLoggedIn — waiting on it is a reliable signal the effect
    // has run far enough that the card's visibility has also settled.
    await waitFor(() => {
      expect(screen.getByDisplayValue("member@example.com")).toBeInTheDocument()
    })
    expect(screen.queryByText("已經是會員了嗎？", { exact: false })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && npx vitest run src/app/checkout/__tests__/page.test.tsx`
Expected: the two new tests FAIL — `MemberReminderCard` doesn't exist yet / the text isn't rendered. The pre-existing "CVS map return" test still passes.

- [ ] **Step 4: Create the card component**

Create `apps/web/src/components/checkout/MemberReminderCard.tsx`:

```tsx
import Link from "next/link"
import { Button } from "@/components/ui/button"

/**
 * Checkout step-1 reminder for logged-out visitors. Many customers only
 * realize AFTER placing an order that they checked out as a guest — missed
 * the first-purchase discount, 公益存款 points, or can't find the order under
 * "我的訂單". Rendered above 收件資訊 only while `!isLoggedIn` — the parent
 * page owns that check; this component has no visibility logic of its own.
 *
 * See docs/superpowers/specs/2026-08-30-guest-checkout-membership-awareness-design.md
 */
export function MemberReminderCard() {
  return (
    <div className="rounded-lg border bg-white p-5 text-left space-y-3">
      <p className="font-semibold" style={{ color: "#10305a" }}>🎁 已經是會員了嗎？</p>
      <p className="text-sm text-zinc-600 leading-relaxed">
        登入即可套用首購折抵與點數回饋
      </p>
      <Link href="/auth/login?next=/checkout" className="block">
        <Button className="w-full rounded-[10px]" style={{ backgroundColor: "#10305a", color: "#fff" }}>
          登入 →
        </Button>
      </Link>
    </div>
  )
}
```

- [ ] **Step 5: Wire it into the checkout page**

In `apps/web/src/app/checkout/page.tsx`:

1. Add the import near the other `@/components/checkout/*` import (after the `PromoWidget` import block):

```tsx
import { MemberReminderCard } from "@/components/checkout/MemberReminderCard"
```

2. Add new state next to `savedAddresses`/`selectedAddressId` (around line 230-231):

```tsx
  const [savedAddresses, setSavedAddresses] = useState<UserAddress[]>([])
  const [selectedAddressId, setSelectedAddressId] = useState<string>("")
  const [isLoggedIn, setIsLoggedIn] = useState(false)
```

3. In the profile/address-prefill effect (2b, the one that does `const { data } = await supabase.auth.getUser()`), set it right after resolving `user` and before the early return:

```tsx
      const user = data.user
      setIsLoggedIn(!!user)
      if (!user) return
```

4. Render the card above the `收件資訊` heading:

```tsx
              <PromoWidget subtotal={subtotal} />

              {!isLoggedIn && <MemberReminderCard />}

              <h1 className="text-2xl font-bold">收件資訊</h1>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/web && npx vitest run src/app/checkout/__tests__/page.test.tsx`
Expected: all 3 tests PASS (the pre-existing CVS test + the 2 new ones).

- [ ] **Step 7: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/checkout/MemberReminderCard.tsx apps/web/src/app/checkout/page.tsx apps/web/src/app/checkout/__tests__/page.test.tsx
git commit -m "feat(checkout): remind logged-out visitors they can log in before checkout"
```

---

## Task 2: Shared membership-CTA HTML helper (backend)

**Files:**
- Create: `apps/api/src/emails/membership-cta.ts`
- Test: `apps/api/src/emails/__tests__/membership-cta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/emails/__tests__/membership-cta.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderMembershipCta } from "../membership-cta"

describe("renderMembershipCta", () => {
  it("links to the checkout confirm page with the order number", () => {
    const html = renderMembershipCta("RR20260830001")
    expect(html).toContain("https://realreal.cc/checkout/confirm?order=RR20260830001")
    expect(html).toContain("加入會員")
  })

  it("URL-encodes an order number with special characters", () => {
    const html = renderMembershipCta("RR 2026#001")
    expect(html).toContain("order=RR%202026%23001")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run src/emails/__tests__/membership-cta.test.ts`
Expected: FAIL — `../membership-cta` doesn't exist.

- [ ] **Step 3: Implement**

Create `apps/api/src/emails/membership-cta.ts`:

```ts
/**
 * Shared "加入會員" HTML block appended to guest-order confirmation emails.
 * Reused by both send paths for a freshly-placed order:
 *   - PaymentConfirmed.ts (online-paid orders — LinePay / PChomePay / JKOPay)
 *   - enqueue-post-payment.ts's notifyOrderPlacedCod (超商取貨付款)
 * Links back to /checkout/confirm?order=<orderNumber>, which already renders
 * GuestRegisterCard (one-click register-from-guest + auto-claim past orders)
 * for any guest order — no new page or backend route needed.
 *
 * See docs/superpowers/specs/2026-08-30-guest-checkout-membership-awareness-design.md
 */
export function renderMembershipCta(orderNumber: string): string {
  const url = `https://realreal.cc/checkout/confirm?order=${encodeURIComponent(orderNumber)}`
  return `<div style="background:#f5f8fc;border:1px solid #dbe6f3;border-radius:8px;padding:16px;margin:20px 0">
    <p style="margin:0 0 8px;font-weight:600;color:#10305a">💡 想讓這筆訂單也算進會員？</p>
    <p style="margin:0 0 12px;font-size:14px;color:#333;line-height:1.6">
      加入會員即可累積公益存款點數、下次購物更快結帳，也能隨時查詢這筆訂單狀態。
    </p>
    <a href="${url}" style="display:inline-block;background:#10305a;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-size:14px;font-weight:600">加入會員 →</a>
  </div>`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run src/emails/__tests__/membership-cta.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/emails/membership-cta.ts apps/api/src/emails/__tests__/membership-cta.test.ts
git commit -m "feat(email): add shared guest-order membership CTA helper"
```

---

## Task 3: Wire the CTA into `PaymentConfirmed.ts` (online-paid orders)

**Files:**
- Modify: `apps/api/src/emails/PaymentConfirmed.ts`
- Modify: `apps/api/src/workers/email-sender.ts`
- Modify: `apps/api/src/lib/enqueue-post-payment.ts`
- Test: `apps/api/src/emails/__tests__/PaymentConfirmed.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/emails/__tests__/PaymentConfirmed.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderPaymentConfirmed } from "../PaymentConfirmed"

const baseData = {
  orderNumber: "RR20260830001",
  amount: "500",
  customerName: "王小明",
  items: [{ name: "初心原味", qty: 1, price: "67" }],
  pickupInfo: "宅配｜台北市",
}

describe("renderPaymentConfirmed — membership CTA", () => {
  it("omits the CTA when isGuestOrder is not set (member order)", () => {
    const html = renderPaymentConfirmed(baseData)
    expect(html).not.toContain("加入會員")
  })

  it("omits the CTA when isGuestOrder is explicitly false", () => {
    const html = renderPaymentConfirmed({ ...baseData, isGuestOrder: false })
    expect(html).not.toContain("加入會員")
  })

  it("includes the CTA when isGuestOrder is true", () => {
    const html = renderPaymentConfirmed({ ...baseData, isGuestOrder: true })
    expect(html).toContain("加入會員")
    expect(html).toContain("/checkout/confirm?order=RR20260830001")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx vitest run src/emails/__tests__/PaymentConfirmed.test.ts`
Expected: the 3rd test FAILS (`isGuestOrder` isn't a recognized field yet, CTA never renders); the first two pass trivially since the CTA doesn't exist at all yet.

- [ ] **Step 3: Add `isGuestOrder` to `renderPaymentConfirmed`**

In `apps/api/src/emails/PaymentConfirmed.ts`, add the import and extend the signature + body:

```ts
import { renderMembershipCta } from "./membership-cta"

export function renderPaymentConfirmed(data: {
  orderNumber: string
  amount: string
  customerName: string
  items: Array<{ name: string; qty: number; price: string }>
  pickupInfo: string
  /** Set only for overseas_cod orders — shipping fee notice, mirrors the checkout page's amber box. */
  codNotice?: string
  /** True when the order has no linked member account (guest_email set, user_id null) — shows a "加入會員" CTA. */
  isGuestOrder?: boolean
}): string {
```

Compute the CTA HTML alongside `codNoticeHtml` (same spot, right after it's defined):

```ts
  const membershipCtaHtml = data.isGuestOrder ? renderMembershipCta(data.orderNumber) : ""
```

Insert it into the returned template, right after `${codNoticeHtml}`:

```ts
    ${codNoticeHtml}
    ${membershipCtaHtml}
    <p>訂單將於 2–5 個工作天備貨出貨。</p>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx vitest run src/emails/__tests__/PaymentConfirmed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Thread `isGuestOrder` through the job type and the caller**

In `apps/api/src/workers/email-sender.ts`, extend the `payment-confirmed` variant of `EmailJobData` (around line 20):

```ts
  | { template: "payment-confirmed"; to: string; data: { orderNumber: string; amount: string; customerName: string; items: Array<{ name: string; qty: number; price: string }>; pickupInfo: string; codNotice?: string; isGuestOrder?: boolean } }
```

No other change needed in `email-sender.ts` — `renderPaymentConfirmed(data)` (in the `case "payment-confirmed":` branch) already forwards the whole `data` object, so the new field passes through automatically once the type allows it. (The `site_contents` DB-override path ignores unknown fields; it only ever reads `{{variable}}` placeholders that are present in the DB template's HTML, which Task 0 already confirmed doesn't exist for this template today.)

In `apps/api/src/lib/enqueue-post-payment.ts`, find the `renderAndSendEmail({ template: "payment-confirmed", ... })` call (around line 162) and add `isGuestOrder` to its `data`:

```ts
        await renderAndSendEmail({
          template: "payment-confirmed",
          to: recipientEmail,
          data: {
            orderNumber: order.order_number,
            amount: String(totalTwd),
            customerName,
            items: mappedItems,
            pickupInfo,
            codNotice,
            isGuestOrder: !order.user_id,
          },
        })
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: only the pre-existing unrelated `bcryptjs` error in `src/lib/phpass.ts` — no new errors.

- [ ] **Step 7: Run the full API test suite**

Run: `cd apps/api && npx vitest run`
Expected: all tests pass (302 pre-existing + the new ones from Task 2 and this task).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/emails/PaymentConfirmed.ts apps/api/src/emails/__tests__/PaymentConfirmed.test.ts apps/api/src/workers/email-sender.ts apps/api/src/lib/enqueue-post-payment.ts
git commit -m "feat(email): show 加入會員 CTA on payment-confirmed emails for guest orders"
```

---

## Task 4: Wire the CTA into `notifyOrderPlacedCod` (超商取貨付款 orders)

**Files:**
- Modify: `apps/api/src/lib/enqueue-post-payment.ts`

This path builds its HTML inline and sends via `sendEmail()` directly (no `site_contents` override risk, no `render*` function to unit-test in isolation — `renderMembershipCta` is already covered by Task 2's tests). Wire it in directly and verify by reading the rendered string in a quick manual check.

- [ ] **Step 1: Import the helper**

At the top of `apps/api/src/lib/enqueue-post-payment.ts`, add:

```ts
import { renderMembershipCta } from "../emails/membership-cta"
```

- [ ] **Step 2: Compute the CTA and insert it into the customer email HTML**

Inside `notifyOrderPlacedCod`, `order.user_id` and `order.order_number` are already in scope. Right before the `--- Customer email: order-placed (COD) ---` block (or at the top of that `if (recipientEmail) { try { ... } }`), compute:

```ts
      const membershipCtaHtml = order.user_id ? "" : renderMembershipCta(order.order_number)
```

Then insert `${membershipCtaHtml}` into the template string, right after the closing `</table>` and before the `<p style="line-height:1.6;">訂單將於 2–5 個工作天備貨出貨...` paragraph:

```ts
          </table>
          ${membershipCtaHtml}
          <p style="line-height:1.6;">
            訂單將於 2–5 個工作天備貨出貨，包裹到達門市後將以簡訊通知您取貨，<br/>
            請攜帶手機至門市出示取件條碼並完成付款。
          </p>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: only the pre-existing unrelated `bcryptjs` error — no new errors.

- [ ] **Step 4: Run the full API test suite**

Run: `cd apps/api && npx vitest run`
Expected: all tests still pass — this task doesn't add new automated tests (see rationale above), only wires an already-tested helper into an already-untested orchestration function.

- [ ] **Step 5: Manual sanity check — render the actual HTML for a guest vs. a member order**

Run (adjust the two `order_id` values to a real recent guest order and a real recent member order from `orders`, or skip and just eyeball the diff logically if none are handy):

```bash
cd apps/api && node -e "
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await supabase.from('orders').select('order_number, user_id, guest_email, payment_method').eq('payment_method', 'cvs_cod').order('created_at', { ascending: false }).limit(5);
  console.log(JSON.stringify(data, null, 2));
})();
"
```

Confirm at least one recent `cvs_cod` order has `user_id: null` — that's the case the new CTA needs to cover. This step is read-only (no email is actually sent); it just confirms the guest-order condition this task branches on is real, current data, not a hypothetical.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/enqueue-post-payment.ts
git commit -m "feat(email): show 加入會員 CTA on CVS COD order-placed emails for guest orders"
```

---

## Task 5: Push and final verification

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Confirm Railway (API) and Vercel (web) deploys succeed**

Check the Railway and Vercel dashboards (or wait ~1-2 minutes and hit the production API health check) — this session cannot call authenticated deploy-status APIs, so this is a manual check by whoever runs this plan.

- [ ] **Step 3: Live browser check — checkout reminder card**

Open `https://realreal.cc/shop` in a logged-out browser session, add any item to cart, go to `/checkout`, and confirm the "🎁 已經是會員了嗎？" card renders above 收件資訊, and that clicking "登入 →" goes to `/auth/login?next=/checkout`.

- [ ] **Step 4: Live browser check — card disappears when logged in**

Log in as any test/real member account, return to `/checkout` with an item in cart, and confirm the card does NOT render.

- [ ] **Step 5: Report to the user**

Summarize what shipped, link the two commits (or PR if the user asks for one), and note that email delivery for the two order-confirmation paths (Task 3, Task 4) was verified via unit tests + manual data inspection rather than a live test email, to avoid sending real production emails during verification — flag that the user can place one real small guest test order + immediately cancel/refund it if they want to see the actual inbox rendering before trusting it fully.
