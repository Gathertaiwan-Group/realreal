import { describe, expect, it } from "vitest"
import { normalizeAdminCategories } from "../admin-categories"

describe("normalizeAdminCategories", () => {
  it("flattens public category trees into admin rows", () => {
    expect(
      normalizeAdminCategories([
        {
          id: "root-1",
          name: "頂層",
          slug: "root",
          parent_id: null,
          sort_order: 1,
          children: [
            {
              id: "child-1",
              name: "子分類",
              slug: "child",
              parent_id: "root-1",
              sort_order: 2,
              children: [],
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "root-1",
        name: "頂層",
        slug: "root",
        parent_id: null,
        sort_order: 1,
      },
      {
        id: "child-1",
        name: "子分類",
        slug: "child",
        parent_id: "root-1",
        sort_order: 2,
      },
    ])
  })

  it("preserves enriched flat admin rows", () => {
    expect(
      normalizeAdminCategories([
        {
          id: "root-1",
          name: "頂層",
          slug: "root",
          parent_id: null,
          sort_order: 1,
          product_count: 3,
          campaign_count: 1,
        },
      ]),
    ).toEqual([
      {
        id: "root-1",
        name: "頂層",
        slug: "root",
        parent_id: null,
        sort_order: 1,
        product_count: 3,
        campaign_count: 1,
      },
    ])
  })
})
