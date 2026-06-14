/**
 * Display status derivation for orders.
 *
 * `orders.status` enum stays as the 6-value canonical state machine
 * (pending / processing / shipped / completed / cancelled / failed),
 * but the admin UI needs finer granularity — specifically distinguishing
 * "CVS arrived but not picked up" vs "in transit", and "picked up" (CVS)
 * vs "delivered" (HOME), plus surfacing "returned unclaimed" (3022 / 326).
 *
 * This helper derives a `DisplayStatus` from the `(order.status,
 * logistics.status, logistics.type)` triple, returning a stable
 * `DisplayStatusKey`, a 繁體中文 label, and a colour token the UI can
 * map onto badges / chips / timeline nodes.
 *
 * The mapping is the source of truth shared by:
 *   - /admin/orders list page (status column)
 *   - /admin/orders/[id] detail page (header badge + timeline)
 *   - list filter chips (?display=... query param)
 *
 * See spec section 1 (docs/superpowers/specs/2026-05-30-order-state-transitions-and-cancellation.md)
 * for the full mapping table and rationale.
 */

export type DisplayStatusKey =
  | "awaiting_payment"
  | "awaiting_shipment"
  | "dispatched"
  | "in_transit"
  | "arrived_cvs"
  | "picked_up"
  | "delivered"
  | "returned_unclaimed"
  | "cancelled"
  | "failed"

export interface DisplayStatus {
  key: DisplayStatusKey
  label: string
  color: "gray" | "blue" | "amber" | "green" | "red"
}

/**
 * Derive a display-layer status for an order from its canonical
 * `orders.status` plus the most recent `logistics` row (if any).
 *
 * Mapping (spec section 1):
 *
 * | order.status | logistics.status | logistics.type | key                | label        | color |
 * |--------------|------------------|----------------|--------------------|--------------|-------|
 * | pending      | —                | —              | awaiting_payment   | 待付款       | gray  |
 * | processing   | null             | —              | awaiting_shipment  | 待出貨       | blue  |
 * | processing   | pending          | —              | dispatched         | 已派工       | blue  |
 * | shipped      | in_transit       | *              | in_transit         | 運送中       | blue  |
 * | shipped      | arrived_cvs      | CVS            | arrived_cvs        | 已到店待取   | amber |
 * | completed    | delivered        | CVS            | picked_up          | 已取貨       | green |
 * | completed    | delivered        | HOME           | delivered          | 已配達       | green |
 * | failed       | returned         | *              | returned_unclaimed | 過期未取退回 | red   |
 * | cancelled    | —                | —              | cancelled          | 已取消       | gray  |
 * | failed       | —                | —              | failed             | 失敗         | red   |
 *
 * `logistics` may be `null` when no logistics row has been created yet
 * (e.g. order still pending payment, or processing but worker hasn't
 * built the ECPay shipment).
 *
 * Fallback: if the `(order.status, logistics.status, logistics.type)`
 * triple does not match any known row, returns
 * `{ key: "failed", label: order.status, color: "gray" }` so the UI
 * still renders something legible rather than crashing.
 */
export function getOrderDisplayStatus(
  order: { status: string },
  logistics: { status: string; type: string } | null,
): DisplayStatus {
  const orderStatus = order.status
  const logisticsStatus = logistics?.status ?? null
  const logisticsType = logistics?.type ?? null

  // pending → 待付款 (logistics irrelevant)
  if (orderStatus === "pending") {
    return { key: "awaiting_payment", label: "待付款", color: "gray" }
  }

  // cancelled → 已取消 (logistics irrelevant)
  if (orderStatus === "cancelled") {
    return { key: "cancelled", label: "已取消", color: "gray" }
  }

  // processing → split on logistics presence/status
  if (orderStatus === "processing") {
    if (logistics === null) {
      return { key: "awaiting_shipment", label: "待出貨", color: "blue" }
    }
    // pending, OR any other logistics status while still processing → 已派工.
    return { key: "dispatched", label: "已派工", color: "blue" }
  }

  // shipped → in_transit / arrived_cvs split
  if (orderStatus === "shipped") {
    if (logisticsStatus === "arrived_cvs" && logisticsType === "CVS") {
      return { key: "arrived_cvs", label: "已到店待取", color: "amber" }
    }
    // in_transit, OR shipped with no/unrecognised logistics row (manually
    // marked shipped, or a sandbox/test order with no ECPay shipment) — show
    // 運送中 rather than falling through to the "failed" fallback that rendered
    // a red ✕ "shipped" banner.
    return { key: "in_transit", label: "運送中", color: "blue" }
  }

  // completed → CVS picked_up vs HOME delivered
  if (orderStatus === "completed") {
    if (logisticsStatus === "delivered" && logisticsType === "CVS") {
      return { key: "picked_up", label: "已取貨", color: "green" }
    }
    // HOME delivered, OR completed with no/unrecognised logistics (manually
    // completed, or a test order) → 已配達 instead of the "failed" fallback.
    return { key: "delivered", label: "已配達", color: "green" }
  }

  // failed → returned_unclaimed (3022 / 326) vs generic failed
  if (orderStatus === "failed") {
    if (logisticsStatus === "returned") {
      return {
        key: "returned_unclaimed",
        label: "過期未取退回",
        color: "red",
      }
    }
    return { key: "failed", label: "失敗", color: "red" }
  }

  // Unrecognised (order.status, logistics.status, logistics.type) triple.
  // Render the raw order.status so admin can still see something legible
  // instead of crashing the UI.
  return { key: "failed", label: order.status, color: "gray" }
}
