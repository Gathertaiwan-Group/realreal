import { createClient } from "@/lib/supabase/client"

/**
 * Account-bound saved address book (table: user_addresses, RLS-scoped).
 *
 * Reads/writes go through the Supabase browser client directly — RLS is the
 * only access control, same pattern as user_profiles. All functions degrade
 * gracefully when the table is missing (SQL migration not yet applied) or the
 * user is logged out: reads return [], writes return null/false.
 */

export type UserAddress = {
  id: string
  name: string
  phone: string
  city: string
  district: string
  postal_code: string
  address_line: string
  is_default: boolean
}

export type UserAddressInput = Omit<UserAddress, "id">

const TABLE = "user_addresses"
const COLUMNS = "id, name, phone, city, district, postal_code, address_line, is_default"
const LEGACY_KEY = "realreal_addresses"

async function currentUserId(): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Clear the default flag on all of a user's rows (before setting a new one). */
async function clearDefaults(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<void> {
  await supabase
    .from(TABLE)
    .update({ is_default: false })
    .eq("user_id", userId)
    .eq("is_default", true)
}

/** All saved addresses for the current user, default first then oldest. */
export async function listUserAddresses(): Promise<UserAddress[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
  if (error || !data) return []
  return data as UserAddress[]
}

export async function createUserAddress(
  input: UserAddressInput,
): Promise<UserAddress | null> {
  const supabase = createClient()
  const userId = await currentUserId()
  if (!userId) return null
  if (input.is_default) await clearDefaults(supabase, userId)
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...input, user_id: userId })
    .select(COLUMNS)
    .single()
  if (error || !data) return null
  return data as UserAddress
}

export async function updateUserAddress(
  id: string,
  input: UserAddressInput,
): Promise<UserAddress | null> {
  const supabase = createClient()
  const userId = await currentUserId()
  if (!userId) return null
  if (input.is_default) await clearDefaults(supabase, userId)
  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...input })
    .eq("id", id)
    .select(COLUMNS)
    .single()
  if (error || !data) return null
  return data as UserAddress
}

export async function deleteUserAddress(id: string): Promise<boolean> {
  const supabase = createClient()
  const { error } = await supabase.from(TABLE).delete().eq("id", id)
  return !error
}

/** Make one address the sole default. */
export async function setDefaultUserAddress(id: string): Promise<boolean> {
  const supabase = createClient()
  const userId = await currentUserId()
  if (!userId) return false
  await clearDefaults(supabase, userId)
  const { error } = await supabase
    .from(TABLE)
    .update({ is_default: true })
    .eq("id", id)
  return !error
}

/**
 * One-time import of the legacy localStorage address book into the backend.
 *
 * Runs only when the backend has no rows yet (so it never clobbers or
 * duplicates), then clears localStorage so it can't re-import. Returns the
 * resulting backend list, or null when there's nothing to migrate / it failed.
 */
export async function migrateLegacyAddresses(): Promise<UserAddress[] | null> {
  if (typeof window === "undefined") return null

  let legacy: UserAddressInput[]
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Array<Partial<UserAddress>>
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.removeItem(LEGACY_KEY)
      return null
    }
    legacy = parsed.map((a) => ({
      name: a.name ?? "",
      phone: a.phone ?? "",
      city: a.city ?? "",
      district: a.district ?? "",
      postal_code: a.postal_code ?? "",
      address_line: a.address_line ?? "",
      is_default: a.is_default ?? false,
    }))
  } catch {
    return null
  }

  const userId = await currentUserId()
  if (!userId) return null

  // Import only into an empty backend — avoids clobbering server data the user
  // may already have on another device.
  const existing = await listUserAddresses()
  if (existing.length > 0) {
    localStorage.removeItem(LEGACY_KEY)
    return existing
  }

  // Enforce exactly one default among the imported rows.
  let defaultSeen = false
  const rows = legacy.map((a) => {
    const isDefault = a.is_default && !defaultSeen
    if (isDefault) defaultSeen = true
    return { ...a, is_default: isDefault, user_id: userId }
  })
  if (!defaultSeen && rows.length > 0) rows[0].is_default = true

  const supabase = createClient()
  const { data, error } = await supabase.from(TABLE).insert(rows).select(COLUMNS)
  if (error) return null

  localStorage.removeItem(LEGACY_KEY)
  return (data as UserAddress[]) ?? []
}
