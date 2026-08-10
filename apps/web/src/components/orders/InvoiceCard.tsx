import { Badge } from "@/components/ui/badge"

type Invoice = {
  id: string
  invoice_number: string | null
  type: string
  status: string
  amount: string
  carrier_type?: string | null
  carrier_number?: string | null
  issued_at?: string | null
}

export function InvoiceCard({ invoice }: { invoice: Invoice }) {
  const statusLabel =
    ({ pending: "開立中", issuing: "開立中", issued: "已開立", voided: "已作廢" } as Record<string, string>)[invoice.status] ??
    invoice.status
  const typeLabel =
    ({ B2C_2: "雲端發票", B2C_3: "載具發票", B2B: "統編發票" } as Record<string, string>)[invoice.type] ??
    invoice.type

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{typeLabel}</span>
        <Badge
          variant={
            invoice.status === "issued"
              ? "default"
              : invoice.status === "voided"
              ? "destructive"
              : "secondary"
          }
        >
          {statusLabel}
        </Badge>
      </div>
      {invoice.invoice_number && (
        <p className="text-sm text-zinc-600">
          發票號碼：<span className="font-mono">{invoice.invoice_number}</span>
        </p>
      )}
      <p className="text-sm">金額：NT${Number(invoice.amount).toLocaleString()}</p>
      {invoice.carrier_number && (
        <p className="text-xs text-zinc-500">載具：{invoice.carrier_number}</p>
      )}
    </div>
  )
}
