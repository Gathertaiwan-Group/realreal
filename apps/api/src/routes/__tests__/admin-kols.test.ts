import { describe, it, expect, vi } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-admin", email: "admin@test.com" } },
    error: null,
  } as any)
}

// recommended_product_ids elements are validated as UUIDs (matches the real
// products.id column type and every other *_id field in this file), so the
// fixture ids below must be valid UUID strings rather than "prod-1" style
// placeholders.
const PROD_1 = "11111111-1111-4111-8111-111111111111"
const PROD_2 = "22222222-2222-4222-8222-222222222222"
const PROD_3 = "33333333-3333-4333-8333-333333333333"

describe("PUT /admin/kols/:id — recommended_product_ids", () => {
  it("filters out product ids that are not active, preserving order of the rest", async () => {
    mockAdminAuth()

    const updatedKol = {
      id: "kol-1",
      slug: "clairelien",
      name: "Claire Lien",
      recommended_product_ids: [PROD_1, PROD_3],
    }

    const updateMock = vi.fn().mockReturnThis()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      if (table === "products") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockResolvedValue({
            // PROD_2 故意不回傳 — 代表它已下架或不存在
            data: [{ id: PROD_1 }, { id: PROD_3 }],
            error: null,
          }),
        } as any
      }
      // kols table
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: updateMock,
        single: vi.fn().mockResolvedValue({ data: updatedKol, error: null }),
      } as any
    })

    const res = await request(app)
      .put("/admin/kols/kol-1")
      .set("Authorization", "Bearer valid-token")
      .send({ recommended_product_ids: [PROD_1, PROD_2, PROD_3] })

    expect(res.status).toBe(200)
    expect(res.body.data.recommended_product_ids).toEqual([PROD_1, PROD_3])
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ recommended_product_ids: [PROD_1, PROD_3] }),
    )
  })
})
