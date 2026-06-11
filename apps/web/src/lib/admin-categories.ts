export interface AdminCategoryRow {
  id: string
  name: string
  slug: string
  parent_id: string | null
  sort_order: number
  product_count?: number
  campaign_count?: number
  created_at?: string
  banner_url?: string | null
  tagline?: string | null
  subtitle?: string | null
  feature_blocks?: Array<{ heading: string; body: string }> | null
  related_post_slugs?: string[] | null
}

interface CategoryTreeNode extends AdminCategoryRow {
  children?: CategoryTreeNode[]
}

export function normalizeAdminCategories(rows: CategoryTreeNode[]): AdminCategoryRow[] {
  const flattened: AdminCategoryRow[] = []

  function visit(row: CategoryTreeNode) {
    const { children, ...category } = row
    flattened.push(category)
    for (const child of children ?? []) visit(child)
  }

  for (const row of rows) visit(row)
  return flattened
}
