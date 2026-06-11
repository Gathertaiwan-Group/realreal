import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock Supabase server client
const mockSignIn = vi.fn()
const mockSignUp = vi.fn()
const mockResetPassword = vi.fn()
const mockSignOut = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: mockSignIn,
      signUp: mockSignUp,
      resetPasswordForEmail: mockResetPassword,
      signOut: mockSignOut,
    },
  }),
}))

vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

const { loginAction, registerAction, forgotPasswordAction } = await import("../actions")

describe("loginAction", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns error for invalid email", async () => {
    const fd = new FormData()
    fd.set("email", "not-an-email")
    fd.set("password", "password123")
    const result = await loginAction(null, fd)
    expect(result?.error).toBeTruthy()
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it("returns error when Supabase auth fails", async () => {
    mockSignIn.mockResolvedValue({ error: { message: "Invalid credentials" } })
    const fd = new FormData()
    fd.set("email", "user@example.com")
    fd.set("password", "password123")
    const result = await loginAction(null, fd)
    expect(result?.error).toBe("Invalid credentials")
  })

  it("calls signInWithPassword with correct credentials", async () => {
    mockSignIn.mockResolvedValue({ error: null })
    const fd = new FormData()
    fd.set("email", "user@example.com")
    fd.set("password", "password123")
    await loginAction(null, fd).catch(() => {}) // redirect throws in test
    expect(mockSignIn).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
    })
  })
})

describe("registerAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SITE_URL = "https://realreal.cc"
  })

  it("returns error for short password", async () => {
    const fd = new FormData()
    fd.set("email", "user@example.com")
    fd.set("password", "short")
    fd.set("displayName", "Test User")
    const result = await registerAction(null, fd)
    expect(result?.error).toBeTruthy()
  })

  it("sends signup confirmation emails through the auth callback", async () => {
    mockSignUp.mockResolvedValue({ error: null })
    const fd = new FormData()
    fd.set("email", "user@example.com")
    fd.set("password", "password123")
    fd.set("displayName", "Test User")

    const result = await registerAction(null, fd)

    expect(result?.success).toBeTruthy()
    expect(mockSignUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
      options: {
        data: { display_name: "Test User" },
        emailRedirectTo: "https://realreal.cc/auth/callback?next=/",
      },
    })
  })
})

describe("forgotPasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SITE_URL = "https://realreal.cc"
  })

  it("returns error when email missing", async () => {
    const result = await forgotPasswordAction(null, new FormData())
    expect(result?.error).toBeTruthy()
  })

  it("returns success message on valid email", async () => {
    mockResetPassword.mockResolvedValue({ error: null })
    const fd = new FormData()
    fd.set("email", "user@example.com")
    const result = await forgotPasswordAction(null, fd)
    expect(result?.success).toBeTruthy()
    // Recovery now routes through /auth/callback so the PKCE code is exchanged
    // into a session before reaching the reset-password page.
    expect(mockResetPassword).toHaveBeenCalledWith("user@example.com", {
      redirectTo: "https://realreal.cc/auth/callback?next=/auth/reset-password",
    })
  })
})
