"use client"
import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { validateCarrierNumber, validateLoveCode, validateTaxId } from "@/lib/invoice-carrier"

export type InvoiceData = {
  type: "B2C_2" | "B2C_3" | "B2B"
  carrierType?: "phone" | "natural_person" | "love_code"
  carrierNumber?: string
  loveCode?: string
  taxId?: string
  companyTitle?: string
}

interface Props {
  value: InvoiceData
  onChange: (v: InvoiceData) => void
}

export function InvoiceSelector({ value, onChange }: Props) {
  // Show format errors only after the field loses focus — flagging "/A" as
  // malformed while someone is still typing /ABC1234 is just noise.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const markTouched = (field: string) => setTouched((t) => ({ ...t, [field]: true }))

  const carrierErr =
    touched.carrier && (value.carrierType === "phone" || value.carrierType === "natural_person" || !value.carrierType)
      ? validateCarrierNumber(value.carrierType ?? "phone", value.carrierNumber)
      : null
  const loveErr = touched.love ? validateLoveCode(value.loveCode) : null
  const taxErr = touched.tax ? validateTaxId(value.taxId) : null

  return (
    <div className="space-y-3">
      <Label className="font-medium">發票類型</Label>
      <RadioGroup
        value={value.type}
        onValueChange={(v) => onChange({ ...value, type: v as InvoiceData["type"] })}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="B2C_2" id="inv-b2c2" />
          <Label htmlFor="inv-b2c2">雲端發票（電子信箱）</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="B2C_3" id="inv-b2c3" />
          <Label htmlFor="inv-b2c3">載具發票</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="B2B" id="inv-b2b" />
          <Label htmlFor="inv-b2b">統編發票（公司用）</Label>
        </div>
      </RadioGroup>

      {value.type === "B2C_3" && (
        <div className="space-y-2 pl-4">
          <RadioGroup
            value={value.carrierType ?? "phone"}
            onValueChange={(v) => onChange({ ...value, carrierType: v as InvoiceData["carrierType"] })}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="phone" id="carrier-phone" />
              <Label htmlFor="carrier-phone">手機條碼</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="natural_person" id="carrier-np" />
              <Label htmlFor="carrier-np">自然人憑證</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="love_code" id="carrier-love" />
              <Label htmlFor="carrier-love">愛心碼</Label>
            </div>
          </RadioGroup>
          {(value.carrierType === "phone" || value.carrierType === "natural_person") && (
            <div className="space-y-1">
              <Input
                placeholder={value.carrierType === "phone" ? "/XXXXXXX（斜線開頭共 8 碼）" : "2 個大寫英文字母 + 14 位數字"}
                value={value.carrierNumber ?? ""}
                onChange={(e) => onChange({ ...value, carrierNumber: e.target.value })}
                onBlur={() => markTouched("carrier")}
                aria-invalid={!!carrierErr}
              />
              {carrierErr && <p className="text-xs text-red-600">{carrierErr}</p>}
            </div>
          )}
          {value.carrierType === "love_code" && (
            <div className="space-y-1">
              <Input
                placeholder="愛心碼（3–7 位數字）"
                value={value.loveCode ?? ""}
                onChange={(e) => onChange({ ...value, loveCode: e.target.value })}
                onBlur={() => markTouched("love")}
                aria-invalid={!!loveErr}
              />
              {loveErr && <p className="text-xs text-red-600">{loveErr}</p>}
            </div>
          )}
        </div>
      )}

      {value.type === "B2B" && (
        <div className="space-y-2 pl-4">
          <div className="space-y-1">
            <Input
              placeholder="統一編號（8 位數字）"
              value={value.taxId ?? ""}
              onChange={(e) => onChange({ ...value, taxId: e.target.value })}
              onBlur={() => markTouched("tax")}
              aria-invalid={!!taxErr}
            />
            {taxErr && <p className="text-xs text-red-600">{taxErr}</p>}
          </div>
          <Input
            placeholder="公司抬頭"
            value={value.companyTitle ?? ""}
            onChange={(e) => onChange({ ...value, companyTitle: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}
