import crypto from "node:crypto"
import { supabase } from "./supabase"

/**
 * Runtime-editable app settings.
 *
 * Spec: docs/superpowers/specs/2026-05-30-admin-runtime-settings-design.md
 *
 * - Values are AES-256-GCM encrypted at rest in the `app_settings` table.
 * - The encryption key comes from `SETTINGS_ENCRYPTION_KEY` (64 hex chars).
 * - `getSetting(key)` is cached in-memory for 30s. Cache is invalidated
 *   explicitly when this process writes (`invalidateSetting`).
 * - The cache is per-process. Railway runs a single api instance + a
 *   single worker instance — each has its own cache. The worker will
 *   pick up a value at most ~30s after the admin saves. Accept that.
 */

const ALGO = "aes-256-gcm"
const TTL_MS = 30_000

function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY ?? ""
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "SETTINGS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)",
    )
  }
  return Buffer.from(raw, "hex")
}

export function encryptSetting(plain: string): string {
  const key = getKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, enc, tag]).toString("base64")
}

export function decryptSetting(b64: string): string {
  const key = getKey()
  const buf = Buffer.from(b64, "base64")
  if (buf.length < 12 + 16 + 1) throw new Error("ciphertext too short")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(buf.length - 16)
  const enc = buf.subarray(12, buf.length - 16)
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
}

type CacheEntry = { value: string | null; expiresAt: number }
const cache = new Map<string, CacheEntry>()

/**
 * Reads a setting from the DB, decrypts, and caches for 30s.
 * Returns `null` if the key is unset OR if decryption fails (so callers
 * can fall back to `process.env.X` safely).
 */
export async function getSetting(key: string): Promise<string | null> {
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return hit.value

  let value: string | null = null
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value_enc")
      .eq("key", key)
      .maybeSingle()
    if (data?.value_enc) {
      value = decryptSetting(data.value_enc as string)
    }
  } catch {
    // DB down OR decryption failure (bad/rotated key) — fall back to env
    // by returning null. Do NOT cache the failure for long.
    cache.set(key, { value: null, expiresAt: Date.now() + 5_000 })
    return null
  }

  cache.set(key, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

/**
 * Read multiple keys in one shot. Lets a credential getter do a single
 * Promise.all instead of N sequential DB hits when nothing is cached.
 */
export async function getSettings(
  keys: readonly string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {}
  await Promise.all(
    keys.map(async (k) => {
      out[k] = await getSetting(k)
    }),
  )
  return out
}

/**
 * Drops a key from the in-process cache so the next read goes to the DB.
 * Call after a write — other processes (worker) will pick up the change
 * lazily within TTL_MS.
 */
export function invalidateSetting(key: string): void {
  cache.delete(key)
}

export function invalidateAllSettings(): void {
  cache.clear()
}

/**
 * Convenience: read a setting OR fall back to a process.env var.
 * Used by every credential getter (pchomepay, ecpay, amego, …).
 */
export async function getSettingOrEnv(
  key: string,
  envName: string,
  fallback = "",
): Promise<string> {
  const v = await getSetting(key)
  if (v !== null && v !== "") return v
  return process.env[envName] ?? fallback
}

/**
 * Allow-list of editable keys. PUT /admin/settings rejects anything not
 * in this set. Lock the surface so admins can't write arbitrary rows.
 */
export const ALLOWED_KEYS = new Set<string>([
  // PChomePay
  "pchomepay.app_id",
  "pchomepay.secret",
  "pchomepay.hash_key",
  "pchomepay.hash_iv",
  "pchomepay.sandbox",
  "pchomepay.pay_types",
  // LINE Pay
  "linepay.channel_id",
  "linepay.channel_secret",
  "linepay.sandbox",
  // JKO Pay
  "jkopay.store_id",
  "jkopay.api_key",
  "jkopay.secret_key",
  "jkopay.sandbox",
  // ECPay Logistics
  "ecpay.merchant_id",
  "ecpay.hash_key",
  "ecpay.hash_iv",
  "ecpay.sandbox",
  "ecpay.sender_name",
  "ecpay.sender_phone",
  "ecpay.sender_zip",
  "ecpay.sender_city",
  "ecpay.sender_address",
  // Amego invoice
  "amego.tax_id",
  "amego.app_key",
  "amego.sandbox",
  // Resend email
  "resend.api_key",
  "resend.from_address",
  "resend.from_name",
  // Notifications
  "notifications.admin_email",
  // Points (charity rebate) — none are secrets
  "points.ratio",
  "points.min_redeem",
  "points.max_redeem_pct",
  "points.allow_coupon_stack",
  "points.apply_to_shipping",
  "points.apply_to_sale",
  "points.expire_days",
])

/**
 * Fields considered secrets — the GET endpoint will never reveal their
 * decrypted value, only `{ set: true, preview: "•••a4b2" }`.
 */
export const SECRET_KEYS = new Set<string>([
  "pchomepay.app_id",
  "pchomepay.secret",
  "pchomepay.hash_key",
  "pchomepay.hash_iv",
  "linepay.channel_id",
  "linepay.channel_secret",
  "jkopay.store_id",
  "jkopay.api_key",
  "jkopay.secret_key",
  "ecpay.merchant_id",
  "ecpay.hash_key",
  "ecpay.hash_iv",
  "amego.tax_id",
  "amego.app_key",
  "resend.api_key",
])

export function maskPreview(value: string): string {
  if (!value) return ""
  if (value.length <= 4) return "•".repeat(value.length)
  return "•".repeat(Math.min(6, value.length - 4)) + value.slice(-4)
}

export const SECTIONS: Record<string, { label: string; keys: string[] }> = {
  pchomepay: {
    label: "PChomePay 支付連",
    keys: [
      "pchomepay.app_id",
      "pchomepay.secret",
      "pchomepay.hash_key",
      "pchomepay.hash_iv",
      "pchomepay.sandbox",
      "pchomepay.pay_types",
    ],
  },
  linepay: {
    label: "LINE Pay",
    keys: ["linepay.channel_id", "linepay.channel_secret", "linepay.sandbox"],
  },
  jkopay: {
    label: "街口支付",
    keys: [
      "jkopay.store_id",
      "jkopay.api_key",
      "jkopay.secret_key",
      "jkopay.sandbox",
    ],
  },
  ecpay: {
    label: "綠界物流 (ECPay)",
    keys: [
      "ecpay.merchant_id",
      "ecpay.hash_key",
      "ecpay.hash_iv",
      "ecpay.sandbox",
      "ecpay.sender_name",
      "ecpay.sender_phone",
      "ecpay.sender_zip",
      "ecpay.sender_city",
      "ecpay.sender_address",
    ],
  },
  amego: {
    label: "Amego 電子發票",
    keys: [
      "amego.tax_id",
      "amego.app_key",
      "amego.sandbox",
    ],
  },
  resend: {
    label: "Resend 通知信",
    keys: ["resend.api_key", "resend.from_address", "resend.from_name"],
  },
  notifications: {
    label: "通知收件人",
    keys: ["notifications.admin_email"],
  },
  points: {
    label: "公益點數規則",
    keys: [
      "points.ratio",
      "points.min_redeem",
      "points.max_redeem_pct",
      "points.allow_coupon_stack",
      "points.apply_to_shipping",
      "points.apply_to_sale",
      "points.expire_days",
    ],
  },
}

/**
 * Default values for runtime settings. The PUT /admin/settings handler can
 * seed these when a key is unset; the points lib also falls back to these
 * defaults via getSettingOrEnv when neither DB nor env supplies a value.
 *
 * Stored as strings because app_settings.value_enc is a TEXT column.
 */
export const SETTING_DEFAULTS: Record<string, string> = {
  "points.ratio": "1",
  "points.min_redeem": "0",
  "points.max_redeem_pct": "100",
  "points.allow_coupon_stack": "true",
  "points.apply_to_shipping": "false",
  "points.apply_to_sale": "true",
  "points.expire_days": "365",
}
