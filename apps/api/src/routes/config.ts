import { Router } from "express"
import { getShippingRule } from "../lib/shipping"

export const configRouter = Router()

// GET /config — public, non-sensitive storefront runtime flags.
//
// `allowTestPaid` mirrors the server-side gate (ALLOW_NON_ADMIN_TEST_PAID) that
// POST /orders enforces, so the checkout UI can show the sandbox "test_paid"
// option iff the server will actually accept it from a non-admin. Read here at
// runtime (server process.env) — deliberately NOT a NEXT_PUBLIC build-time flag,
// because that has to be inlined at build and is easy to get wrong / forget.
//
// ⚠️ test_paid marks an order paid WITHOUT real payment. Removing the single
// Railway env ALLOW_NON_ADMIN_TEST_PAID before go-live both hides the button
// (this flag flips to false) and makes the server reject it — atomic.
configRouter.get("/", async (_req, res) => {
  // Free-shipping thresholds, read live from the same getShippingRule() the
  // checkout math uses. Exposed so storefront copy (marquee, FAQ, checkout
  // hints) can print the REAL numbers instead of hardcoded ones.
  //
  // Why: the marquee said 649 / 999 while the settings actually held 650 /
  // 1000, so a customer at exactly 999 on 宅配 was promised free shipping and
  // charged NT$150. Hardcoded copy drifts silently every time the thresholds
  // are edited in admin; reading them here means it cannot drift again.
  //
  // Non-fatal: a settings hiccup must never break the storefront shell, so a
  // failure returns nulls and the caller falls back to omitting the numbers.
  let shipping: {
    cvs: { fee: number; free_threshold: number }
    cvsCod: { fee: number; free_threshold: number }
    home: { fee: number; free_threshold: number }
  } | null = null
  try {
    const [cvs, cvsCod, home] = await Promise.all([
      getShippingRule("cvs_711"),
      getShippingRule("cvs_711", "cvs_cod"),
      getShippingRule("home_delivery"),
    ])
    shipping = { cvs, cvsCod, home }
  } catch (err) {
    console.warn("[config] shipping rule lookup failed (non-fatal):", err)
  }

  res.json({
    allowTestPaid: process.env.ALLOW_NON_ADMIN_TEST_PAID === "true",
    shipping,
  })
})
