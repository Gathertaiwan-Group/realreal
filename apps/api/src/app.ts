import express, { type Request, type Response, type NextFunction } from "express"
import cookieParser from "cookie-parser"
import { Sentry } from "./sentry"

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://realreal-seven.vercel.app",
  "https://realreal-store.vercel.app",
  "https://realreal.cc",
  "https://www.realreal.cc",
]
import healthRouter from "./routes/health"
import { categoriesRouter, categoriesAdminRouter } from "./routes/categories"
import { productsRouter, productsAdminRouter } from "./routes/products"
import { variantsRouter } from "./routes/variants"
import { couponsRouter } from "./routes/coupons"
import { analyticsRouter } from "./routes/analytics"
import { invoicesRouter } from "./routes/invoices"
import { amegoWebhookRouter } from "./routes/webhooks/amego"
import { requireAuth } from "./middleware/auth"
import { requireAdmin } from "./middleware/admin"
import { ordersRouter } from "./routes/orders"
import { pchomepayWebhookRouter } from "./routes/webhooks/pchomepay"
import { linepayWebhookRouter } from "./routes/webhooks/linepay"
import { jkopayWebhookRouter } from "./routes/webhooks/jkopay"
import { ecpayLogisticsWebhookRouter } from "./routes/webhooks/ecpay-logistics"
import { logisticsRouter } from "./routes/logistics"
import { subscriptionPlansRouter, subscriptionsRouter } from "./routes/subscriptions"
import { pchomepayTokenWebhookRouter } from "./routes/webhooks/pchomepay-token"
import { postsPublicRouter, postsAdminRouter } from "./routes/posts"
import { postCategoriesPublicRouter, postCategoriesAdminRouter } from "./routes/post-categories"
import { postTagsPublicRouter, postTagsAdminRouter } from "./routes/post-tags"
import { siteContentsRouter } from "./routes/site-contents"
import { usersRouter } from "./routes/users"
import { tiersRouter } from "./routes/tiers"
import { campaignsRouter } from "./routes/campaigns"
import { reviewsPublicRouter, reviewsAdminRouter } from "./routes/reviews"
import { adminOrdersRouter } from "./routes/admin-orders"
import { adminSettingsRouter } from "./routes/admin-settings"
import { adminTeamRouter } from "./routes/admin-team"
import { adminCustomersRouter } from "./routes/admin-customers"
import { pointsRouter } from "./routes/points"
import { kolsRouter } from "./routes/kols"
import { adminKolsRouter } from "./routes/admin-kols"
import { requireInternal } from "./middleware/internal"
import { supabase } from "./lib/supabase"

export const app = express()

// CORS — must be first so preflight OPTIONS requests are handled before any auth checks
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin ?? ""
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin)
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization")
  res.setHeader("Access-Control-Allow-Credentials", "true")
  if (req.method === "OPTIONS") { res.sendStatus(204); return }
  next()
})

// Raw body parser for webhook routes that need form-encoded bodies
// (PChomePay and ECPay Logistics use application/x-www-form-urlencoded)
// Must be registered BEFORE express.json() so these routes get the right parser
app.use("/webhooks/pchomepay", express.urlencoded({ extended: false }))
app.use("/webhooks/ecpay-logistics", express.urlencoded({ extended: false }))
app.use("/logistics/map-result", express.urlencoded({ extended: false }))

// Capture the raw request body for routes that need byte-exact HMAC
// verification (JKOPay + Amego webhooks).
app.use(
  express.json({
    limit: "5mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString("utf8")
    },
  }),
)
// Cookie parser — needed for Spec I (KOL affiliate cookie `kol_ref` read in /orders POST).
app.use(cookieParser())
app.use("/health", healthRouter)
app.use("/categories", categoriesRouter)
app.use("/admin/categories", categoriesAdminRouter)
app.use("/products/:id/variants", variantsRouter)
app.use("/admin/products", productsAdminRouter)
app.use("/products", productsRouter)
app.use("/", couponsRouter)
app.use("/", analyticsRouter)
app.use("/admin/invoices", requireAuth, requireAdmin, invoicesRouter)
app.use("/webhooks/amego", amegoWebhookRouter)
app.use("/admin/orders", adminOrdersRouter)
app.use("/admin/settings", adminSettingsRouter)
app.use("/admin/team", adminTeamRouter)
app.use("/admin/customers", adminCustomersRouter)
app.use("/orders", ordersRouter)
app.use("/webhooks/pchomepay", pchomepayWebhookRouter)
app.use("/webhooks/linepay", linepayWebhookRouter)
app.use("/webhooks/jkopay", jkopayWebhookRouter)
app.use("/webhooks/ecpay-logistics", ecpayLogisticsWebhookRouter)
app.use("/logistics", logisticsRouter)
app.use("/subscription-plans", subscriptionPlansRouter)
app.use("/subscriptions", requireAuth, subscriptionsRouter)
app.use("/webhooks/pchomepay-token", pchomepayTokenWebhookRouter)
app.use("/posts", postsPublicRouter)
app.use("/admin/posts", postsAdminRouter)
app.use("/post-categories", postCategoriesPublicRouter)
app.use("/admin/post-categories", postCategoriesAdminRouter)
app.use("/post-tags", postTagsPublicRouter)
app.use("/admin/post-tags", postTagsAdminRouter)
app.use("/", siteContentsRouter)
app.use("/", usersRouter)
app.use("/", tiersRouter)
app.use("/", campaignsRouter)
app.use("/products/:productId/reviews", reviewsPublicRouter)
app.use("/admin/reviews", reviewsAdminRouter)
app.use("/points", pointsRouter)
app.use("/kols", kolsRouter)
app.use("/admin/kols", adminKolsRouter)

// TEMP: one-shot DB patch — remove after use
app.post("/internal/db-patch", requireInternal, async (_req, res) => {
  const GIFT_CAT_ID = "c6489e2f-1a47-45fc-ac39-034b177ccd06"
  const PRODUCT_IDS = [
    "1f4085e3-14c7-45c7-a71f-69372297a0c7", // 滋養禮盒
    "ef8762c8-eac8-4560-a0fb-e15ad0163da4", // 輕鬆補給禮
  ]
  const { error: catErr } = await supabase.from("categories").update({ name: "送禮推薦" }).eq("id", GIFT_CAT_ID)
  if (catErr) { res.status(500).json({ step: "rename_category", error: catErr.message }); return }
  const { error: prodErr } = await supabase.from("products").update({ category_id: GIFT_CAT_ID }).in("id", PRODUCT_IDS)
  if (prodErr) { res.status(500).json({ step: "update_products", error: prodErr.message }); return }
  res.json({ ok: true, renamed: "禮物→送禮推薦", updated_products: PRODUCT_IDS.length })
})

app.use((_req, res) => { res.status(404).json({ error: "Not found" }) })
// Sentry error handler — must come before any other error middleware and after all controllers
// Cast to any because @sentry/node returns its own ExpressErrorMiddleware type that doesn't
// satisfy Express 5's stricter overload signatures, even though it's runtime-compatible.
app.use(Sentry.expressErrorHandler() as any)
// Global error handler (must have 4 args for Express to treat it as error handler)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: "Internal server error" })
})
