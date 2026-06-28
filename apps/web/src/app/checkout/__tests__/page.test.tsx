import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import CheckoutPage from "../page"
import { useCart } from "@/lib/cart"

const replaceMock = vi.fn()
const pushMock = vi.fn()
let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParams,
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

describe("CheckoutPage CVS map return", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    searchParams = new URLSearchParams()
    useCart.setState({
      items: [
        {
          variantId: "variant-1",
          productName: "植物蛋白",
          variantName: "原味",
          price: 100,
          qty: 1,
        },
      ],
    })
    global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
    window.history.replaceState = vi.fn()
  })

  it("keeps the selected CVS store after same-tab mobile map return", async () => {
    localStorage.setItem(
      "realreal-cvs-draft",
      JSON.stringify({
        name: "王小明",
        phone: "0912345678",
        email: "test@example.com",
        addressType: "cvs",
        city: "",
        district: "",
        postalCode: "",
        addressLine: "",
        shippingMethod: "family",
        invoice: { type: "B2C_2" },
        country: "",
        expiresAt: Date.now() + 60_000,
      }),
    )
    searchParams = new URLSearchParams({
      cvsStoreId: "016958",
      cvsStoreName: "全家誠真店",
      cvsAddress: "台北市測試路 1 號",
      logisticsSubType: "FAMIC2C",
    })

    render(<CheckoutPage />)

    await waitFor(() => {
      expect(screen.getByText("全家誠真店")).toBeInTheDocument()
    })
    expect(screen.getByText("門市編號：016958")).toBeInTheDocument()
    expect(screen.queryByText("尚未選擇取貨門市")).not.toBeInTheDocument()
  })
})
