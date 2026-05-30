import { describe, it, expect, vi, beforeEach } from "vitest"
import request from "supertest"

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}))

import { app } from "../../app"
import { supabase } from "../../lib/supabase"

const mockSiteContent = {
  id: "sc-1",
  key: "homepage_banner",
  value: { title: "歡迎光臨", subtitle: "最好的保健品" },
  updated_by: "user-admin",
  updated_at: new Date().toISOString(),
}

function mockEditorAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-editor", email: "editor@test.com" } },
    error: null,
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /site-contents/:key (public)
// ---------------------------------------------------------------------------

describe("GET /site-contents/:key", () => {
  it("returns value for existing key", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { value: mockSiteContent.value },
        error: null,
      }),
    } as any)

    const res = await request(app).get("/site-contents/homepage_banner")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
    expect(res.body.data).toHaveProperty("title")
  })

  it("returns 404 for nonexistent key", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
    } as any)

    const res = await request(app).get("/site-contents/nonexistent_key")
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("Key not found")
  })

  it("returns 500 on supabase error", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { value: null }, error: { message: "db error" } }),
    } as any)

    const res = await request(app).get("/site-contents/broken_key")
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// PUT /admin/site-contents/:key (auth + editor)
// ---------------------------------------------------------------------------

describe("PUT /admin/site-contents/:key", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .put("/admin/site-contents/homepage_banner")
      .send({ value: { title: "New" } })
    expect(res.status).toBe(401)
  })

  it("returns 403 for non-editor/non-admin", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-viewer", email: "viewer@test.com" } },
      error: null,
    } as any)
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "customer" }, error: null }),
        } as any
      }
      return {} as any
    })

    const res = await request(app)
      .put("/admin/site-contents/homepage_banner")
      .set("Authorization", "Bearer valid-token")
      .send({ value: { title: "New" } })
    expect(res.status).toBe(403)
  })

  it("returns 400 for extra fields (strict schema)", async () => {
    mockEditorAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
        } as any
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      } as any
    })

    const res = await request(app)
      .put("/admin/site-contents/homepage_banner")
      .set("Authorization", "Bearer valid-token")
      .send({ value: { title: "New" }, extraField: "bad" })
    expect(res.status).toBe(400)
  })

  it("creates the key when it does not exist (upsert)", async () => {
    // Route uses upsert (changed in c6c60bc) — unknown keys are created,
    // not rejected. This test guards that behavior.
    mockEditorAuth()

    const created = { id: "sc-new", key: "newly_created_key", value: { title: "Oops" } }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
        } as any
      }
      if (table === "site_contents") {
        return {
          upsert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: created, error: null }),
        } as any
      }
      return {} as any
    })

    const res = await request(app)
      .put("/admin/site-contents/newly_created_key")
      .set("Authorization", "Bearer valid-token")
      .send({ value: { title: "Oops" } })
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(created)
  })

  it("updates site content for editor", async () => {
    mockEditorAuth()

    const updated = { ...mockSiteContent, value: { title: "Updated" } }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
        } as any
      }
      if (table === "site_contents") {
        return {
          upsert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: updated, error: null }),
        } as any
      }
      return {} as any
    })

    const res = await request(app)
      .put("/admin/site-contents/homepage_banner")
      .set("Authorization", "Bearer valid-token")
      .send({ value: { title: "Updated" } })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
  })
})
