import { describe, expect, it } from "vitest"
import {
  buildProductCreatePayload,
  createEmptyVariant,
  validateProductDraft,
  type ProductCreateDraft,
} from "../product-create"

function makeDraft(overrides: Partial<ProductCreateDraft> = {}): ProductCreateDraft {
  return {
    name: "30 天植物蛋白組",
    slug: "protein-30-pack",
    categoryId: "11111111-1111-4111-8111-111111111111",
    excerpt: "<p>摘要</p>",
    description: "<p>描述</p>",
    images: [{ url: "https://example.com/main.jpg", alt: "主圖" }],
    isActive: true,
    isFeatured: false,
    isAddon: false,
    displayPriority: 10,
    variants: [
      {
        clientId: "variant-1",
        name: "30 包",
        sku: "PROTEIN-30",
        price: 1680,
        salePrice: 1499,
        stockQty: 20,
        weight: 900,
        attributes: { 包數: "30", 類型: "綜合" },
      },
    ],
    ...overrides,
  }
}

describe("product creation helpers", () => {
  it("creates a usable empty variant", () => {
    expect(createEmptyVariant("v1")).toEqual({
      clientId: "v1",
      name: "預設規格",
      sku: "",
      price: 0,
      salePrice: null,
      stockQty: 0,
      weight: null,
      attributes: {},
    })
  })

  it("rejects duplicate SKUs and sale prices above regular prices", () => {
    const draft = makeDraft({
      variants: [
        { ...createEmptyVariant("a"), name: "A", sku: "SAME", price: 100, salePrice: 120 },
        { ...createEmptyVariant("b"), name: "B", sku: "same", price: 200 },
      ],
    })

    expect(validateProductDraft(draft)).toEqual(
      expect.arrayContaining([
        "規格「A」的特價不可高於原價",
        "SKU「SAME」重複",
      ]),
    )
  })

  it("builds the nested admin API payload", () => {
    expect(buildProductCreatePayload(makeDraft())).toEqual({
      product: {
        name: "30 天植物蛋白組",
        slug: "protein-30-pack",
        category_id: "11111111-1111-4111-8111-111111111111",
        excerpt: "<p>摘要</p>",
        description: "<p>描述</p>",
        images: [
          {
            url: "https://example.com/main.jpg",
            alt: "主圖",
            sort_order: 0,
          },
        ],
        is_active: true,
        is_featured: false,
        is_addon: false,
        display_priority: 10,
      },
      variants: [
        {
          name: "30 包",
          sku: "PROTEIN-30",
          price: 1680,
          sale_price: 1499,
          stock_qty: 20,
          weight: 900,
          attributes: { 包數: "30", 類型: "綜合" },
        },
      ],
    })
  })
})
