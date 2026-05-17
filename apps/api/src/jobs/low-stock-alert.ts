import { supabase } from "../lib/supabase"

export const LOW_STOCK_THRESHOLD = 5

export async function processLowStockAlert() {
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, sku, name, stock_qty, product_id")
    .lte("stock_qty", LOW_STOCK_THRESHOLD)

  if (error) throw error

  // Log low stock items (email notifications added in Plan 8)
  if (data && data.length > 0) {
    console.log(`[low-stock-alert] ${data.length} variants below threshold:`,
      data.map(v => `${v.sku ?? v.id}: ${v.stock_qty}`))
  }

  return { count: data?.length ?? 0 }
}
