import { describe, it, expect } from "vitest"
import { resolveKolRef } from "../kol-ref"

describe("resolveKolRef", () => {
  it("captures ?ref=<slug> on any page", () => {
    expect(resolveKolRef("/", "coolkol")).toBe("coolkol")
    expect(resolveKolRef("/shop/foo", "cool-kol-2")).toBe("cool-kol-2")
  })

  it("captures the /k/<slug> landing path (the fix)", () => {
    expect(resolveKolRef("/k/coolkol", null)).toBe("coolkol")
    expect(resolveKolRef("/k/coolkol/", null)).toBe("coolkol") // trailing slash
  })

  it("prefers an explicit ?ref over the landing path", () => {
    expect(resolveKolRef("/k/landingkol", "querykol")).toBe("querykol")
  })

  it("returns null when there's nothing valid to capture", () => {
    expect(resolveKolRef("/shop/foo", null)).toBeNull()
    expect(resolveKolRef("/k/", null)).toBeNull() // no slug
    expect(resolveKolRef("/k/a/b", null)).toBeNull() // not a leaf landing path
  })

  it("rejects malformed slugs", () => {
    expect(resolveKolRef("/", "Bad Slug!")).toBeNull()
    expect(resolveKolRef("/", "UPPER")).toBeNull()
    expect(resolveKolRef("/k/Bad_Slug", null)).toBeNull() // caps/underscore not in path regex
  })
})
