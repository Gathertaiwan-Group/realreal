import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before importing the SUT
// ---------------------------------------------------------------------------

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}))

// settings.ts is consulted by points.ts to look up runtime config (ratio,
// expire_days, …). Hoist a controllable mock that lets every test set the
// values it cares about without poking app_settings.
vi.mock("../src/lib/settings", () => ({
  getSettingOrEnv: vi.fn(async (_key: string, _env: string, fallback = "") => fallback),
}))

import {
  grantPoints,
  redeemPoints,
  expirePoints,
  refundOrderPoints,
  adjustPoints,
  getEffectiveRedeemablePoints,
  calcPointsDiscount,
  type PointsSettings,
} from "../src/lib/points"
import { supabase } from "../src/lib/supabase"
import { getSettingOrEnv } from "../src/lib/settings"

// ---------------------------------------------------------------------------
// Helpers — let each test compose the supabase.from(table) chain it needs
// ---------------------------------------------------------------------------

/**
 * Captures every insert() payload written to points_ledger so tests can
 * assert the ledger rows the implementation produced.
 *
 * Optional per-table overrides let a test stub other tables in the same
 * call chain (membership_tiers for grantPoints, the select chain for
 * expirePoints / refundOrderPoints).
 */
type FromHandler = (table: string) => unknown
function makeFrom(handlers: Record<string, FromHandler>) {
  return (table: string) => {
    const h = handlers[table]
    return h ? (h as any)(table) : {}
  }
}

/**
 * Stubs out the typical `from('points_ledger').insert(payload)` call and
 * records the payload(s). Insert returns a benign `{ error: null }` so the
 * caller can `await` it without exploding.
 */
function pointsLedgerInsertCapturer(opts: { priorExists?: boolean } = {}) {
  const writes: Array<Record<string, unknown> | Array<Record<string, unknown>>> = []
  const handler = (_table: string) => ({
    // SELECT-first idempotency guard added in commit 7d0ca5f calls
    // .select("id").eq().eq().maybeSingle() → must return null so the
    // insert path runs.
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.priorExists ? { id: "prior-row" } : null,
      error: null,
    }),
    insert: vi.fn().mockImplementation((payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
      writes.push(payload)
      return Promise.resolve({ error: null, data: payload })
    }),
  })
  return { writes, handler }
}

// user_profiles handler returning tier_expires_at (future = valid, past =
// expired, null = no expiry). Used by grantPoints (added in round 2 audit
// fix M5) and other tier-aware paths.
function userProfilesHandler(profile: Record<string, unknown> | null) {
  return () => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null }),
    single: vi.fn().mockResolvedValue({ data: profile, error: null }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: every getSettingOrEnv call returns its fallback (matches
  // points.ts defaults). Individual tests override per-key as needed.
  vi.mocked(getSettingOrEnv).mockImplementation(
    async (_key: string, _env: string, fallback = "") => fallback,
  )
})

// ---------------------------------------------------------------------------
// 1. grantPoints — earn ledger row with rebate_rate=5% on NT$1000 → +50
// ---------------------------------------------------------------------------

describe("grantPoints", () => {
  it("writes +50 earn row on NT$1000 with 5% rebate tier", async () => {
    const ORDER_ID = "order-1"
    const USER_ID = "user-1"
    const TIER_ID = "tier-silver"

    const { writes, handler: ledgerHandler } = pointsLedgerInsertCapturer()

    vi.mocked(supabase.from).mockImplementation(
      makeFrom({
        user_profiles: userProfilesHandler({ tier_expires_at: null }),
        membership_tiers: () => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { rebate_rate: 5 }, error: null }),
        }),
        points_ledger: ledgerHandler,
      }) as never,
    )

    // expire_days fallback = 365 means the row WILL have an expires_at
    vi.mocked(getSettingOrEnv).mockResolvedValue("365")

    const earned = await grantPoints(ORDER_ID, USER_ID, 1000, TIER_ID)

    expect(earned).toBe(50)
    expect(writes).toHaveLength(1)
    const row = writes[0] as Record<string, unknown>
    expect(row).toMatchObject({
      user_id: USER_ID,
      delta: 50,
      source: "earn",
      source_ref_id: ORDER_ID,
    })
    // expires_at must be set (string ISO) since expire_days > 0
    expect(typeof row.expires_at).toBe("string")
  })

  it("returns 0 and writes nothing when tierId is null", async () => {
    const { writes } = pointsLedgerInsertCapturer()
    const result = await grantPoints("order-x", "user-x", 1000, null)
    expect(result).toBe(0)
    expect(writes).toHaveLength(0)
  })

  it("returns 0 when tier rebate_rate is 0", async () => {
    const { writes, handler: ledgerHandler } = pointsLedgerInsertCapturer()
    vi.mocked(supabase.from).mockImplementation(
      makeFrom({
        user_profiles: userProfilesHandler({ tier_expires_at: null }),
        membership_tiers: () => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { rebate_rate: 0 }, error: null }),
        }),
        points_ledger: ledgerHandler,
      }) as never,
    )
    const result = await grantPoints("order-y", "user-y", 1000, "tier-basic")
    expect(result).toBe(0)
    expect(writes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 2. redeemPoints — -100 redeem ledger row
// ---------------------------------------------------------------------------

describe("redeemPoints", () => {
  it("writes -100 redeem row on pointsUsed=100", async () => {
    const ORDER_ID = "order-2"
    const USER_ID = "user-2"
    const { writes, handler } = pointsLedgerInsertCapturer()
    vi.mocked(supabase.from).mockImplementation(
      makeFrom({ points_ledger: handler }) as never,
    )

    await redeemPoints(ORDER_ID, USER_ID, 100)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      user_id: USER_ID,
      delta: -100,
      source: "redeem",
      source_ref_id: ORDER_ID,
    })
  })

  it("is a no-op when pointsUsed <= 0", async () => {
    const { writes, handler } = pointsLedgerInsertCapturer()
    vi.mocked(supabase.from).mockImplementation(
      makeFrom({ points_ledger: handler }) as never,
    )
    await redeemPoints("order-z", "user-z", 0)
    await redeemPoints("order-z", "user-z", -5)
    expect(writes).toHaveLength(0)
  })
})

describe("getEffectiveRedeemablePoints", () => {
  it("excludes expired earn rows and pending orders without redeem ledger rows", async () => {
    const now = new Date("2026-06-10T04:00:00.000Z")
    let ledgerCall = 0

    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "points_ledger") {
        ledgerCall++
        if (ledgerCall === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                { delta: 100, source: "earn", expires_at: "2026-06-11T00:00:00.000Z" },
                { delta: 50, source: "earn", expires_at: "2026-06-09T00:00:00.000Z" },
                { delta: -20, source: "redeem", expires_at: null },
              ],
              error: null,
            }),
          } as any
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any
      }

      if (table === "orders") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gt: vi.fn().mockResolvedValue({
            data: [{ id: "pending-order", points_used: 30 }],
            error: null,
          }),
        } as any
      }

      return {} as any
    }) as never)

    await expect(getEffectiveRedeemablePoints("user-1", now)).resolves.toBe(50)
  })
})

// ---------------------------------------------------------------------------
// 3. expirePoints — one earn row past expiry → -delta expire row written
// ---------------------------------------------------------------------------

describe("expirePoints", () => {
  it("writes a -delta expire row for one earn row past expiry", async () => {
    const NOW = new Date("2026-06-01T00:00:00.000Z")

    // First .from('points_ledger') call: select expired earn rows
    // Second .from('points_ledger') call: select existing expire rows (none)
    // Third .from('points_ledger') call: insert expire rows
    const expiredEarn = [
      { id: "earn-1", user_id: "user-A", delta: 50 },
    ]

    const writes: Array<unknown> = []
    let callIdx = 0
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table !== "points_ledger") return {} as any
      callIdx++
      if (callIdx === 1) {
        // candidate earn rows — chain .eq().not().lt().limit() per audit M16 fix
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: expiredEarn, error: null }),
        } as any
      }
      if (callIdx === 2) {
        // existing expire rows lookup — chain .eq().in()
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as any
      }
      // insert
      return {
        insert: vi.fn().mockImplementation((payload: unknown) => {
          writes.push(payload)
          return Promise.resolve({ error: null })
        }),
      } as any
    }) as never)

    const result = await expirePoints(NOW)

    expect(result).toEqual({ rows: 1, total: 50 })
    expect(writes).toHaveLength(1)
    // payload should be an array of expire rows
    const inserted = writes[0] as Array<Record<string, unknown>>
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      user_id: "user-A",
      delta: -50,
      source: "expire",
      source_ref_id: "earn-1",
    })
  })

  it("returns {rows:0,total:0} when there are no expired earn rows", async () => {
    vi.mocked(supabase.from).mockImplementation(((_table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      lt: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    })) as never)

    const result = await expirePoints(new Date())
    expect(result).toEqual({ rows: 0, total: 0 })
  })
})

// ---------------------------------------------------------------------------
// 4. refundOrderPoints — reverses both earn and redeem rows
// ---------------------------------------------------------------------------

describe("refundOrderPoints", () => {
  it("writes two refund rows (one per earn + one per redeem) for an order", async () => {
    const ORDER_ID = "order-3"
    const USER_ID = "user-3"

    // Call order after round-2 fixes:
    //   1. SELECT-first prior refund check (limit chain → resolves [])
    //   2. earn rows for order (select.eq.eq.eq)
    //   3. expire ledger filter (select.eq.in) per H11 fix
    //   4. redeem rows for order
    //   5. insert
    let callIdx = 0
    const writes: Array<unknown> = []
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table !== "points_ledger") return {} as any
      callIdx++
      if (callIdx === 1) {
        // SELECT-first guard
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as any
      }
      if (callIdx === 2) {
        // earn rows
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValueOnce({
            eq: vi.fn().mockReturnValueOnce({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: "earn-1", delta: 50 }],
                error: null,
              }),
            }),
          }),
        } as any
      }
      if (callIdx === 3) {
        // expire ledger filter (audit H11) — none expired
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as any
      }
      if (callIdx === 4) {
        // redeem rows
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValueOnce({
            eq: vi.fn().mockReturnValueOnce({
              eq: vi.fn().mockResolvedValue({
                data: [{ delta: -100 }],
                error: null,
              }),
            }),
          }),
        } as any
      }
      // 5th call: insert
      return {
        insert: vi.fn().mockImplementation((payload: unknown) => {
          writes.push(payload)
          return Promise.resolve({ error: null })
        }),
      } as any
    }) as never)

    const result = await refundOrderPoints(ORDER_ID, USER_ID)

    expect(result).toEqual({ earned_reverted: 50, redeemed_returned: 100 })
    expect(writes).toHaveLength(1)
    const inserts = writes[0] as Array<Record<string, unknown>>
    expect(inserts).toHaveLength(2)
    // earn clawback row: delta -50
    expect(inserts).toContainEqual(
      expect.objectContaining({
        user_id: USER_ID,
        delta: -50,
        source: "refund",
        source_ref_id: ORDER_ID,
        note: "earn revert",
      }),
    )
    // redeem return row: delta +100 (flip of -100)
    expect(inserts).toContainEqual(
      expect.objectContaining({
        user_id: USER_ID,
        delta: 100,
        source: "refund",
        source_ref_id: ORDER_ID,
        note: "redeem return",
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// 5. adjustPoints — empty note throws
// ---------------------------------------------------------------------------

describe("adjustPoints", () => {
  it("throws when note is empty string", async () => {
    await expect(adjustPoints("user-x", 10, "", "admin-1")).rejects.toThrow(
      /note is required/i,
    )
  })

  it("throws when note is whitespace-only", async () => {
    await expect(adjustPoints("user-x", 10, "   ", "admin-1")).rejects.toThrow(
      /note is required/i,
    )
  })

  it("writes a manual_adjust row with trimmed note and actor_id", async () => {
    const { writes, handler } = pointsLedgerInsertCapturer()
    vi.mocked(supabase.from).mockImplementation(
      makeFrom({ points_ledger: handler }) as never,
    )

    await adjustPoints("user-7", -15, "  bonus correction  ", "admin-99")

    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      user_id: "user-7",
      delta: -15,
      source: "manual_adjust",
      note: "bonus correction",
      actor_id: "admin-99",
      expires_at: null,
    })
  })
})

// ---------------------------------------------------------------------------
// 6. calcPointsDiscount — pure function, no mocks needed
// ---------------------------------------------------------------------------

const baseSettings: PointsSettings = {
  ratio: 1,
  min_redeem: 0,
  max_redeem_pct: 100,
  allow_coupon_stack: true,
  apply_to_shipping: false,
  apply_to_sale: true,
  expire_days: 365,
}

const baseCart = {
  subtotal: 1000,
  shipping: 100,
  sale_item_total: 200,
  total: 1100,
}

describe("calcPointsDiscount", () => {
  // Spec D: min_redeem / max_redeem_pct / apply_to_shipping / apply_to_sale
  // are now hardcoded defaults (0 / 100% / false / true). Only `ratio` is
  // read from settings. Tests for the removed toggles deleted; behaviour
  // verified via the consolidated tests below.

  it("respects hardcoded defaults: max=100% of subtotal, shipping excluded", () => {
    // subtotal=1000 (shipping excluded), ratio=1 → cap=1000, maxPts=1000
    const ok = calcPointsDiscount(baseCart, 1000, { ratio: 1 })
    expect(ok.allowed).toBe(true)
    if (ok.allowed) expect(ok.discount).toBe(1000)

    // 1001 exceeds cap
    const overflow = calcPointsDiscount(baseCart, 1001, { ratio: 1 })
    expect(overflow.allowed).toBe(false)
  })

  it("ratio scales discount correctly (1 點 = NT$ 2)", () => {
    const result = calcPointsDiscount(baseCart, 100, { ratio: 2 })
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.discount).toBe(200)
  })

  it("rejects requested > cap after ratio multiplier (cap = floor(subtotal/ratio))", () => {
    // ratio=2, subtotal=1000 → cap=1000, maxPts=floor(1000/2)=500
    const result = calcPointsDiscount(baseCart, 501, { ratio: 2 })
    expect(result.allowed).toBe(false)
  })

  it("rejects zero / negative requestedPoints", () => {
    const zero = calcPointsDiscount(baseCart, 0, { ratio: 1 })
    expect(zero.allowed).toBe(false)
    const neg = calcPointsDiscount(baseCart, -10, { ratio: 1 })
    expect(neg.allowed).toBe(false)
  })
})
