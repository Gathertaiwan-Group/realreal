import { Router } from "express"
import { getShippingRule } from "../lib/shipping"
import { supabase } from "../lib/supabase"

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

  // 目前生效中的免運「活動」（跟上面的常態門檻不同）。
  //
  // 例：週六限定、超商取貨滿 666 免運。跑馬燈要能講這件事，但**不能寫死** ——
  // 常態門檻寫死的那句已經出過兩次錯（649/999 對不上實際設定）。這裡把活動的
  // 條件原樣送出去，文案由前端依條件組出來，後台改門檻或星期就自己跟著變。
  //
  // 只送條件、不送任何內部識別，是公開端點該有的樣子。
  let shippingCampaigns: Array<{
    minOrder: number
    buckets: string[]
    weekdays: number[]
  }> = []
  try {
    const now = new Date().toISOString()
    const { data } = await supabase
      .from("campaigns")
      .select("config, starts_at, ends_at")
      .eq("type", "free_shipping")
      .eq("is_active", true)
      .lte("starts_at", now)
    shippingCampaigns = (data ?? [])
      .filter((c) => !c.ends_at || (c.ends_at as string) > now)
      .map((c) => {
        const cfg = (c.config ?? {}) as Record<string, unknown>
        return {
          minOrder: Number(cfg.min_order_amount ?? 0),
          buckets: Array.isArray(cfg.shipping_buckets)
            ? (cfg.shipping_buckets as unknown[]).map(String)
            : [],
          weekdays: Array.isArray(cfg.active_weekdays)
            ? (cfg.active_weekdays as unknown[]).map(Number)
            : [],
        }
      })
      .filter((c) => c.minOrder > 0)
  } catch (err) {
    console.warn("[config] free-shipping campaign lookup failed (non-fatal):", err)
  }

  res.json({
    allowTestPaid: process.env.ALLOW_NON_ADMIN_TEST_PAID === "true",
    shipping,
    shippingCampaigns,
  })
})
