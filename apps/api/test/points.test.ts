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
function pointsLedgerInsertCapturer() {
  const writes: Array<Record<string, unknown> | Array<Record<string, unknown>>> = []
  const handler = (_table: string) => ({
    insert: vi.fn().mockImplementation((payload: Record<string, unknown> | Array<Record<string, unknown>>) => {
      writes.push(payload)
      return Promise.resolve({ error: null })
    }),
  })
  return { writes, handler }
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
        // candidate earn rows — chain .eq().not().lt()
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          lt: vi.fn().mockResolvedValue({ data: expiredEarn, error: null }),
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
      lt: vi.fn().mockResolvedValue({ data: [], error: null }),
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

    // earn lookup, redeem lookup, then insert
    let callIdx = 0
    const writes: Array<unknown> = []
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table !== "points_ledger") return {} as any
      callIdx++
      if (callIdx === 1) {
        // earn rows for order — three .eq() chained then resolves
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValueOnce({
            eq: vi.fn().mockReturnValueOnce({
              eq: vi.fn().mockResolvedValue({
                data: [{ delta: 50 }],
                error: null,
              }),
            }),
          }),
        } as any
      }
      if (callIdx === 2) {
        // redeem rows for order
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
      // 3rd call: insert
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
  describe("min_redeem reject", () => {
    it("returns allowed=false when requested < min_redeem", () => {
      const result = calcPointsDiscount(
        baseCart,
        5,
        { ...baseSettings, min_redeem: 10 },
      )
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toMatch(/最少.*10/)
      }
    })
  })

  describe("max_pct cap", () => {
    it("returns allowed=false when requested > floor(subtotal * max_pct / 100 / ratio)", () => {
      // subtotal=1000, max_pct=50 → cap=500 → maxPts=500 (ratio=1)
      const result = calcPointsDiscount(
        baseCart,
        501,
        { ...baseSettings, max_redeem_pct: 50 },
      )
      expect(result.allowed).toBe(false)
      if (!result.allowed) {
        expect(result.reason).toMatch(/最多.*500/)
      }
    })

    it("accepts requested at the cap exactly", () => {
      const result = calcPointsDiscount(
        baseCart,
        500,
        { ...baseSettings, max_redeem_pct: 50 },
      )
      expect(result.allowed).toBe(true)
      if (result.allowed) expect(result.discount).toBe(500)
    })
  })

  describe("apply_to_shipping toggle", () => {
    it("when false (default), eligible base = subtotal (excludes shipping)", () => {
      // subtotal=1000, max=100 → cap=1000 → maxPts=1000
      const result = calcPointsDiscount(
        baseCart,
        1000,
        { ...baseSettings, apply_to_shipping: false, apply_to_sale: true },
      )
      expect(result.allowed).toBe(true)
      // 1001 exceeds (cap=1000)
      const overflow = calcPointsDiscount(
        baseCart,
        1001,
        { ...baseSettings, apply_to_shipping: false, apply_to_sale: true },
      )
      expect(overflow.allowed).toBe(false)
    })

    it("when true, eligible base = total (includes shipping)", () => {
      // total=1100, max=100 → cap=1100 → maxPts=1100
      const result = calcPointsDiscount(
        baseCart,
        1100,
        { ...baseSettings, apply_to_shipping: true, apply_to_sale: true },
      )
      expect(result.allowed).toBe(true)
      if (result.allowed) expect(result.discount).toBe(1100)
    })
  })

  describe("apply_to_sale toggle", () => {
    it("when true, sale items DO contribute to eligible base", () => {
      // subtotal=1000 (includes sale 200), apply_to_sale=true → eligible=1000
      const result = calcPointsDiscount(
        baseCart,
        1000,
        { ...baseSettings, apply_to_sale: true, apply_to_shipping: false },
      )
      expect(result.allowed).toBe(true)
    })

    it("when false, sale items are SUBTRACTED from eligible base", () => {
      // subtotal=1000 - sale_item_total=200 → eligible=800 → maxPts=800
      const okAtCap = calcPointsDiscount(
        baseCart,
        800,
        { ...baseSettings, apply_to_sale: false, apply_to_shipping: false },
      )
      expect(okAtCap.allowed).toBe(true)
      const overflow = calcPointsDiscount(
        baseCart,
        801,
        { ...baseSettings, apply_to_sale: false, apply_to_shipping: false },
      )
      expect(overflow.allowed).toBe(false)
    })
  })
})
