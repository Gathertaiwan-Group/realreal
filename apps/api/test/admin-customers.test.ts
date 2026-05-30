import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before importing the app
// ---------------------------------------------------------------------------

vi.mock("../src/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: {
      getUser: vi.fn(),
      admin: {
        getUserById: vi.fn(),
        generateLink: vi.fn(),
      },
    },
  },
}))

vi.mock("../src/lib/points", () => ({
  adjustPoints: vi.fn(),
}))

import { app } from "../src/app"
import { supabase } from "../src/lib/supabase"
import { adjustPoints } from "../src/lib/points"

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = "user-admin"
// Use real RFC 4122 v4 UUIDs because zod v4's .uuid() validator enforces
// the version + variant bits (rejects all-1s / all-2s shortcuts).
const CUSTOMER_ID = "d9407d20-e6e9-4b7d-be93-3c0d6470addb"
const TIER_ID = "15d8c23a-0508-4e27-93c9-fc80b220746a"

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: ADMIN_USER_ID, email: "admin@test.com" } },
    error: null,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /admin/customers/:id — shape
// ---------------------------------------------------------------------------

describe("GET /admin/customers/:id", () => {
  it("returns the assembled detail payload (profile + tier + points + orders + ledger + next_tier)", async () => {
    mockAdminAuth()

    // Mock auth.admin.getUserById — used to attach email + last_sign_in_at
    vi.mocked(supabase.auth.admin.getUserById).mockResolvedValue({
      data: {
        user: {
          id: CUSTOMER_ID,
          email: "customer@test.com",
          last_sign_in_at: "2026-05-29T12:00:00Z",
        },
      },
      error: null,
    } as never)

    const profileRow = {
      user_id: CUSTOMER_ID,
      display_name: "Test Customer",
      phone: "0912345678",
      birthday: "1990-01-01",
      role: "customer",
      created_at: "2026-01-01T00:00:00Z",
      total_spend: 5000,
      membership_tier_id: TIER_ID,
      membership_tiers: {
        id: TIER_ID,
        name: "知心之友",
        min_spend: 3000,
        rebate_rate: 2,
        benefits: { free_shipping: true },
        discount_rate: 5,
        sort_order: 2,
      },
    }

    const allLedger = [
      { delta: 100 },
      { delta: -30 },
    ]
    const expiringEarn = [{ id: "earn-1", delta: 50 }]
    const existingExpire: Array<{ source_ref_id: string }> = []

    const recentOrders = [
      {
        id: "order-1",
        order_number: "RR0001",
        total: 1000,
        status: "completed",
        payment_status: "paid",
        points_used: 0,
        created_at: "2026-05-01T00:00:00Z",
      },
    ]

    const ledgerRows = [
      {
        id: "led-1",
        delta: 50,
        source: "earn",
        source_ref_id: "order-1",
        note: null,
        expires_at: "2027-05-01T00:00:00Z",
        actor_id: null,
        created_at: "2026-05-01T00:00:00Z",
      },
    ]

    const nextTierRow = [
      { id: "tier-3", name: "同心之友", min_spend: 10000, rebate_rate: 3 },
    ]

    // points_ledger is called multiple times — keep an index
    let pointsLedgerCallIdx = 0
    let userProfilesCallIdx = 0

    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        userProfilesCallIdx++
        // call 1: requireAdmin guard returns admin role
        // call 2: the route's profile+tier join
        const data =
          userProfilesCallIdx === 1 ? { role: "admin" } : profileRow
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data, error: null }),
        } as any
      }
      if (table === "points_ledger") {
        pointsLedgerCallIdx++
        // call 1: SUM(delta) all rows (.eq().resolves)
        if (pointsLedgerCallIdx === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: allLedger, error: null }),
          } as any
        }
        // call 2: expiringRows (.eq().eq().not().gte().lt())
        if (pointsLedgerCallIdx === 2) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            lt: vi.fn().mockResolvedValue({ data: expiringEarn, error: null }),
          } as any
        }
        // call 3: existing expire lookup (.eq().in())
        if (pointsLedgerCallIdx === 3) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: existingExpire, error: null }),
          } as any
        }
        // call 4: ledger rows (.eq().order().limit())
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: ledgerRows, error: null }),
        } as any
      }
      if (table === "orders") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: recentOrders, error: null }),
        } as any
      }
      if (table === "membership_tiers") {
        return {
          select: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: nextTierRow, error: null }),
        } as any
      }
      return {} as any
    }) as never)

    const res = await request(app)
      .get(`/admin/customers/${CUSTOMER_ID}`)
      .set("Authorization", "Bearer valid-token")

    expect(res.status).toBe(200)
    expect(res.body.data).toBeDefined()

    // shape
    expect(res.body.data.profile).toMatchObject({
      user_id: CUSTOMER_ID,
      display_name: "Test Customer",
      phone: "0912345678",
      email: "customer@test.com",
      last_sign_in_at: "2026-05-29T12:00:00Z",
      total_spend: 5000,
    })
    expect(res.body.data.tier).toMatchObject({
      id: TIER_ID,
      name: "知心之友",
      rebate_rate: 2,
    })
    expect(res.body.data.points).toEqual({
      balance: 70, // 100 + -30
      expiring_soon: 50,
    })
    expect(Array.isArray(res.body.data.orders)).toBe(true)
    expect(res.body.data.orders[0].order_number).toBe("RR0001")
    expect(Array.isArray(res.body.data.ledger)).toBe(true)
    expect(res.body.data.ledger[0].id).toBe("led-1")
    expect(res.body.data.next_tier).toMatchObject({
      id: "tier-3",
      name: "同心之友",
      min_spend: 10000,
    })
  })

  it("returns 404 when the profile does not exist", async () => {
    mockAdminAuth()
    let userProfilesCallIdx = 0
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        userProfilesCallIdx++
        const data =
          userProfilesCallIdx === 1 ? { role: "admin" } : null
        const error =
          userProfilesCallIdx === 1 ? null : { message: "not found" }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data, error }),
        } as any
      }
      return {} as any
    }) as never)

    const res = await request(app)
      .get(`/admin/customers/${CUSTOMER_ID}`)
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /admin/customers/:id/points/adjust — calls adjustPoints with the
// admin's user id as actor
// ---------------------------------------------------------------------------

describe("POST /admin/customers/:id/points/adjust", () => {
  it("calls adjustPoints(userId, delta, note, adminId) and returns ok:true", async () => {
    mockAdminAuth()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {} as any
    }) as never)

    vi.mocked(adjustPoints).mockResolvedValue(undefined)

    const res = await request(app)
      .post(`/admin/customers/${CUSTOMER_ID}/points/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ delta: 50, note: "loyalty bonus" })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(adjustPoints).toHaveBeenCalledWith(
      CUSTOMER_ID,
      50,
      "loyalty bonus",
      ADMIN_USER_ID,
    )
  })

  it("returns 400 when note is empty", async () => {
    mockAdminAuth()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {} as any
    }) as never)

    const res = await request(app)
      .post(`/admin/customers/${CUSTOMER_ID}/points/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ delta: 5, note: "" })

    expect(res.status).toBe(400)
    expect(adjustPoints).not.toHaveBeenCalled()
  })

  it("returns 400 when delta is zero", async () => {
    mockAdminAuth()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {} as any
    }) as never)

    const res = await request(app)
      .post(`/admin/customers/${CUSTOMER_ID}/points/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ delta: 0, note: "should fail" })

    expect(res.status).toBe(400)
    expect(adjustPoints).not.toHaveBeenCalled()
  })

  it("returns 500 when adjustPoints throws", async () => {
    mockAdminAuth()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {} as any
    }) as never)
    vi.mocked(adjustPoints).mockRejectedValue(new Error("db boom"))

    const res = await request(app)
      .post(`/admin/customers/${CUSTOMER_ID}/points/adjust`)
      .set("Authorization", "Bearer valid-token")
      .send({ delta: 5, note: "ok" })

    expect(res.status).toBe(500)
    expect(res.body.error).toBe("db boom")
  })
})

// ---------------------------------------------------------------------------
// PATCH /admin/customers/:id/tier — updates profile.membership_tier_id
// ---------------------------------------------------------------------------

describe("PATCH /admin/customers/:id/tier", () => {
  it("updates user_profiles.membership_tier_id when the tier exists", async () => {
    mockAdminAuth()

    const updates: Array<Record<string, unknown>> = []

    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        // First call: requireAdmin returns role; second call: update payload
        let callCount = 0
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation(() => ({
            single: vi.fn().mockResolvedValue({
              data: { role: "admin" },
              error: null,
            }),
          })),
          update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
            updates.push(payload)
            callCount++
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            }
          }),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      if (table === "membership_tiers") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: { id: TIER_ID }, error: null }),
        } as any
      }
      return {} as any
    }) as never)

    const res = await request(app)
      .patch(`/admin/customers/${CUSTOMER_ID}/tier`)
      .set("Authorization", "Bearer valid-token")
      .send({ tier_id: TIER_ID })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({ membership_tier_id: TIER_ID })
  })

  it("returns 400 when tier_id is not a uuid", async () => {
    mockAdminAuth()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {} as any
    }) as never)

    const res = await request(app)
      .patch(`/admin/customers/${CUSTOMER_ID}/tier`)
      .set("Authorization", "Bearer valid-token")
      .send({ tier_id: "not-a-uuid" })

    expect(res.status).toBe(400)
  })

  it("returns 400 when tier does not exist", async () => {
    mockAdminAuth()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      if (table === "membership_tiers") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any
      }
      return {} as any
    }) as never)

    const res = await request(app)
      .patch(`/admin/customers/${CUSTOMER_ID}/tier`)
      .set("Authorization", "Bearer valid-token")
      .send({ tier_id: TIER_ID })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe("Tier not found")
  })
})
