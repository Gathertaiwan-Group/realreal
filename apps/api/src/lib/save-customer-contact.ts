import { supabase } from "./supabase"

// Subset of the parsed order address we need (createOrderSchema → addressSchema).
type AddressInput = {
  name: string
  phone: string
  addressType: "home" | "cvs" | "overseas"
  address?: string
  city?: string
  district?: string
  postalCode?: string
  country?: string
}

/**
 * After an order is created, persist the buyer's contact + delivery info so the
 * NEXT checkout pre-fills it. The checkout page (apps/web checkout/page.tsx)
 * reads `user_profiles.phone` and the default `user_addresses` entry, so we
 * write to both:
 *
 *  1. Phone → user_profiles.phone — for EVERY order type (incl. 超商取貨, whose
 *     "address" is a store, not a real address) so the phone always carries over.
 *  2. Full address → user_addresses (as the default) — only for real addresses
 *     (宅配 / 海外寄送). Deduped so repeat orders to the same place don't pile up.
 *
 * Logged-in users only. Best-effort: callers MUST treat failures as non-fatal —
 * saving contact info must never break order creation.
 */
export async function saveCustomerContact(opts: {
  userId: string
  address: AddressInput
}): Promise<void> {
  const { userId, address } = opts
  const phone = (address.phone ?? "").trim()

  // 1) Phone → profile (all order types).
  if (phone) {
    await supabase.from("user_profiles").update({ phone }).eq("user_id", userId)
  }

  // 2) Full address → address book, for real addresses only.
  const isRealAddress =
    address.addressType === "home" || address.addressType === "overseas"
  if (!isRealAddress) return

  const street = (address.address ?? "").trim()
  if (!street) return

  // user_addresses has no country column → fold it into the line for overseas
  // (mirrors how order_addresses stores "[Country] …").
  const addressLine = address.country
    ? `[${address.country}] ${street}`.trim()
    : street
  const name = (address.name ?? "").trim()
  const city = (address.city ?? "").trim()
  const district = (address.district ?? "").trim()
  const postalCode = (address.postalCode ?? "").trim()

  // Dedup: reuse an identical existing entry instead of accumulating duplicates.
  const { data: existing } = await supabase
    .from("user_addresses")
    .select("id")
    .eq("user_id", userId)
    .eq("phone", phone)
    .eq("address_line", addressLine)
    .eq("city", city)
    .eq("postal_code", postalCode)
    .limit(1)
    .maybeSingle()

  // Make this the sole default (clear any previous default first).
  await supabase
    .from("user_addresses")
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true)

  if (existing?.id) {
    const { error } = await supabase
      .from("user_addresses")
      .update({ name, district, is_default: true })
      .eq("id", existing.id)
    if (error) console.warn("[save-customer-contact] update default failed:", error.message)
  } else {
    const { error } = await supabase.from("user_addresses").insert({
      user_id: userId,
      name,
      phone,
      city,
      district,
      postal_code: postalCode,
      address_line: addressLine,
      is_default: true,
    })
    if (error) console.warn("[save-customer-contact] insert failed:", error.message)
  }
}
