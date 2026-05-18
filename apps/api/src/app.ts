import express, { type Request, type Response, type NextFunction } from "express"

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://realreal-seven.vercel.app",
  "https://realreal-store.vercel.app",
  "https://realreal.cc",
  "https://www.realreal.cc",
]
import healthRouter from "./routes/health"
import { categoriesRouter } from "./routes/categories"
import { productsRouter } from "./routes/products"
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
import { mediaRouter } from "./routes/media"
import { requireEditor } from "./middleware/editor"
import { siteContentsRouter } from "./routes/site-contents"
import { usersRouter } from "./routes/users"
import { tiersRouter } from "./routes/tiers"
import { campaignsRouter } from "./routes/campaigns"
import { reviewsPublicRouter, reviewsAdminRouter } from "./routes/reviews"
import { adminOrdersRouter } from "./routes/admin-orders"

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

app.use(express.json({ limit: "5mb" }))
app.use("/health", healthRouter)
app.use("/categories", categoriesRouter)
app.use("/products/:id/variants", variantsRouter)
app.use("/products", productsRouter)
app.use("/", couponsRouter)
app.use("/", analyticsRouter)
app.use("/admin/invoices", requireAuth, requireAdmin, invoicesRouter)
app.use("/webhooks/amego", amegoWebhookRouter)
app.use("/admin/orders", adminOrdersRouter)
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
app.use("/admin/media", requireAuth, requireEditor, mediaRouter)
app.use("/", siteContentsRouter)
app.use("/", usersRouter)
app.use("/", tiersRouter)
app.use("/", campaignsRouter)
app.use("/products/:productId/reviews", reviewsPublicRouter)
app.use("/admin/reviews", reviewsAdminRouter)
app.use((_req, res) => { res.status(404).json({ error: "Not found" }) })
// Global error handler (must have 4 args for Express to treat it as error handler)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: "Internal server error" })
})
