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

const mockPost = {
  id: "post-1",
  title: "測試文章",
  slug: "test-post",
  excerpt: "這是測試摘要",
  content_html: "<p>Hello</p>",
  cover_image: null,
  status: "published",
  category_id: null,
  seo_title: null,
  seo_description: null,
  scheduled_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}

function mockAdminAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-admin", email: "admin@test.com" } },
    error: null,
  } as any)
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "user_profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
      } as any
    }
    return buildPostQuery() as any
  })
}

function mockEditorAuth() {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { id: "user-editor", email: "editor@test.com" } },
    error: null,
  } as any)
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "user_profiles") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
      } as any
    }
    return buildPostQuery() as any
  })
}

function buildPostQuery(data: any = [mockPost], error: any = null) {
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data, error, count: data?.length ?? 0 }),
    single: vi.fn().mockResolvedValue({ data: data?.[0] ?? null, error }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /posts (public, paginated)
// ---------------------------------------------------------------------------

describe("GET /posts", () => {
  it("returns paginated published posts", async () => {
    const result = { data: [mockPost], error: null, count: 1 }
    const chainable: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: any) => resolve(result)),
    }
    vi.mocked(supabase.from).mockReturnValue(chainable)

    const res = await request(app).get("/posts?page=1&limit=10")
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty("data")
    expect(res.body).toHaveProperty("total")
    expect(res.body.total).toBe(1)
  })

  it("returns empty list when no posts", async () => {
    const result = { data: [], error: null, count: 0 }
    const chainable: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: any) => resolve(result)),
    }
    vi.mocked(supabase.from).mockReturnValue(chainable)

    const res = await request(app).get("/posts")
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.total).toBe(0)
  })

  it("returns 500 on supabase error", async () => {
    const result = { data: null, error: { message: "db error" }, count: null }
    const chainable: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      then: vi.fn((resolve: any) => resolve(result)),
    }
    vi.mocked(supabase.from).mockReturnValue(chainable)

    const res = await request(app).get("/posts")
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// GET /posts/:slug (public)
// ---------------------------------------------------------------------------

describe("GET /posts/:slug", () => {
  it("returns a published post by slug", async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "post_tag_links") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        } as any
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockPost, error: null }),
      } as any
    })

    const res = await request(app).get("/posts/test-post")
    expect(res.status).toBe(200)
    expect(res.body.data).toHaveProperty("title")
    expect(res.body.data).toHaveProperty("slug")
    expect(res.body.data).toHaveProperty("tags")
  })

  it("returns 404 for nonexistent slug", async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST116" } }),
    } as any)

    const res = await request(app).get("/posts/nonexistent")
    expect(res.status).toBe(404)
    expect(res.body.error).toBe("Post not found")
  })
})

// ---------------------------------------------------------------------------
// POST /admin/posts (auth + editor)
// ---------------------------------------------------------------------------

describe("POST /admin/posts", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/admin/posts")
      .send({ title: "New Post" })
    expect(res.status).toBe(401)
  })

  it("returns 403 for viewer role", async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-viewer", email: "viewer@test.com" } },
      error: null,
    } as any)
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "viewer" }, error: null }),
        } as any
      }
      return buildPostQuery() as any
    })

    const res = await request(app)
      .post("/admin/posts")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "New Post" })
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid body (missing title)", async () => {
    mockEditorAuth()

    const res = await request(app)
      .post("/admin/posts")
      .set("Authorization", "Bearer valid-token")
      .send({ excerpt: "no title" })
    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty("error")
  })

  it("creates a post for editor", async () => {
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
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockPost, error: null }),
      } as any
    })

    const res = await request(app)
      .post("/admin/posts")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "測試文章", content_html: "<p>Hello</p>" })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty("data")
  })
})

// ---------------------------------------------------------------------------
// PUT /admin/posts/:id (auth + editor)
// ---------------------------------------------------------------------------

describe("PUT /admin/posts/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .put("/admin/posts/post-1")
      .send({ title: "Updated" })
    expect(res.status).toBe(401)
  })

  it("updates a post for editor", async () => {
    mockEditorAuth()

    const updated = { ...mockPost, title: "Updated Title" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "editor" }, error: null }),
        } as any
      }
      if (table === "post_tag_links") {
        return {
          delete: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        } as any
      }
      return {
        update: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: updated, error: null }),
      } as any
    })

    const res = await request(app)
      .put("/admin/posts/post-1")
      .set("Authorization", "Bearer valid-token")
      .send({ title: "Updated Title" })
    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe("Updated Title")
  })
})

// ---------------------------------------------------------------------------
// DELETE /admin/posts/:id (auth + admin)
// ---------------------------------------------------------------------------

describe("DELETE /admin/posts/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).delete("/admin/posts/post-1")
    expect(res.status).toBe(401)
  })

  it("returns 403 for editor (admin-only delete)", async () => {
    mockEditorAuth()

    const res = await request(app)
      .delete("/admin/posts/post-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(403)
  })

  it("deletes a post for admin", async () => {
    mockAdminAuth()

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
        } as any
      }
      return {
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      } as any
    })

    const res = await request(app)
      .delete("/admin/posts/post-1")
      .set("Authorization", "Bearer valid-token")
    expect(res.status).toBe(204)
  })
})
