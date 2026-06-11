import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import AdminProductsClient from "../_client"

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}))

describe("AdminProductsClient", () => {
  it("shows which products are enabled for the addon area", () => {
    render(
      <AdminProductsClient
        initialProducts={[
          {
            id: "product-1",
            name: "測試加購商品",
            slug: "test-addon",
            is_active: true,
            is_featured: false,
            is_addon: true,
            display_priority: 0,
            created_at: "2026-06-12T00:00:00.000Z",
          },
        ]}
        archived={false}
      />,
    )

    expect(screen.getByText("加購")).toBeInTheDocument()
  })
})
