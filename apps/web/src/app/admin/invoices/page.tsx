import { redirect } from "next/navigation"

/**
 * Legacy /admin/invoices route. The standalone list page was removed —
 * invoice info + actions (作廢 / 重新開立 / 查看 PDF) now live inside the
 * order-detail page where they have the order context. Old bookmarks
 * land on the orders list.
 */
export default function AdminInvoicesRedirect() {
  redirect("/admin/orders")
}
