/**
 * GA4 event helpers — push onto `window.dataLayer` so GTM tags can forward
 * them to GA4 (or any other platform configured in the GTM workspace).
 *
 * Spec L (docs/superpowers/specs/2026-05-31-L-ga4-gtm-sentry-integration-design.md)
 * §2 — `lib/analytics.ts` event helpers.
 *
 * All helpers are SSR-safe: each guards on `typeof window !== "undefined"`
 * so they're no-ops during server rendering / build prerender.  The
 * `dataLayer` may not yet be initialised when the helper fires (Analytics.tsx
 * sets it up `afterInteractive`), so we use optional chaining + a fallback
 * push to defer until GTM is ready.
 */

type DataLayerWindow = Window & { dataLayer?: Array<Record<string, unknown>> }

function push(event: Record<string, unknown>): void {
  if (typeof window === "undefined") return
  const w = window as DataLayerWindow
  // Initialise lazily — GTM's bootstrap script does the same idempotently.
  w.dataLayer = w.dataLayer || []
  w.dataLayer.push(event)
}

export interface PurchaseItem {
  sku: string
  name: string
  unit_price: number
  qty: number
}

export interface PurchaseOrder {
  id: string
  total: number
  items: PurchaseItem[]
  kol_slug?: string | null
}

/**
 * Fire GA4 `purchase` event after a successful checkout.
 * Called from /checkout/confirm once payment_status === "success".
 */
export function trackPurchase(order: PurchaseOrder): void {
  push({
    event: "purchase",
    ecommerce: {
      transaction_id: order.id,
      value: order.total,
      currency: "TWD",
      items: order.items.map(i => ({
        item_id: i.sku,
        item_name: i.name,
        price: i.unit_price,
        quantity: i.qty,
      })),
      affiliation: order.kol_slug ? `kol:${order.kol_slug}` : undefined,
    },
  })
}

/**
 * Fire GA4 `view_promotion` event when a visitor lands on a KOL page.
 * Called from /k/[slug] client mount — see _client.tsx.
 */
export function trackKolView(kolSlug: string): void {
  push({
    event: "view_promotion",
    promotion_id: `kol:${kolSlug}`,
    promotion_name: kolSlug,
  })
}

/**
 * Fire GA4 `add_to_cart` event when a customer adds an item to their cart.
 *
 * TODO(spec-L v1): not yet wired. Add call site in shop/product detail's
 * "加入購物車" handler (apps/web/src/app/shop/[slug] or wherever cart.add
 * lives) — needs careful UI hookup so we only fire on user intent, not on
 * cart hydration / SSR.
 */
export function trackAddToCart(item: PurchaseItem): void {
  push({
    event: "add_to_cart",
    ecommerce: {
      currency: "TWD",
      value: item.unit_price * item.qty,
      items: [
        {
          item_id: item.sku,
          item_name: item.name,
          price: item.unit_price,
          quantity: item.qty,
        },
      ],
    },
  })
}

/**
 * Fire GA4 `begin_checkout` event when a customer enters the checkout flow.
 *
 * TODO(spec-L v1): not yet wired. Add call site in /checkout/payment mount,
 * but only once (guard with useRef) — otherwise re-renders / step-back will
 * inflate the funnel count.
 */
export function trackBeginCheckout(cart: {
  items: PurchaseItem[]
  total: number
}): void {
  push({
    event: "begin_checkout",
    ecommerce: {
      currency: "TWD",
      value: cart.total,
      items: cart.items.map(i => ({
        item_id: i.sku,
        item_name: i.name,
        price: i.unit_price,
        quantity: i.qty,
      })),
    },
  })
}
