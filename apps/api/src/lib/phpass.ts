/**
 * PHPass portable hash verifier — minimal implementation sufficient for
 * checking WordPress wp_users.user_pass values during the legacy-login
 * fallback flow. WordPress uses Openwall's portable hash format:
 *
 *   $P$<itoa64(count_log2)><8 char salt><22 char hash>
 *
 * The hash is MD5 stretched 2^count_log2 iterations (default 13 → 8192).
 * From WP 6.8 onward bcrypt + a $wp$ prefix wraps the bcrypt hash; we
 * route those to standard bcrypt.
 *
 * No dependencies beyond Node's crypto module so we don't drag a heavy
 * library into the worker bundle.
 */
import crypto from "crypto"

const ITOA64 =
  "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

function encode64(input: Buffer, count: number): string {
  let out = ""
  let i = 0
  while (i < count) {
    let value = input[i++] ?? 0
    out += ITOA64[value & 0x3f]
    if (i < count) value |= (input[i] ?? 0) << 8
    out += ITOA64[(value >> 6) & 0x3f]
    if (i++ >= count) break
    if (i < count) value |= (input[i] ?? 0) << 16
    out += ITOA64[(value >> 12) & 0x3f]
    if (i++ >= count) break
    out += ITOA64[(value >> 18) & 0x3f]
  }
  return out
}

/**
 * Verify a plaintext password against a WordPress PHPass portable hash.
 * Returns false for unsupported formats (including bcrypt-wrapped $wp$);
 * the caller falls back to its normal verifier in that case.
 */
export function verifyPhpassPortable(password: string, hash: string): boolean {
  if (typeof hash !== "string" || hash.length !== 34) return false
  if (hash[0] !== "$" || hash[2] !== "$") return false
  if (hash[1] !== "P" && hash[1] !== "H") return false

  const countLog2 = ITOA64.indexOf(hash[3])
  if (countLog2 < 7 || countLog2 > 30) return false

  const salt = hash.substring(4, 12)
  if (salt.length !== 8) return false

  let h = crypto
    .createHash("md5")
    .update(Buffer.concat([Buffer.from(salt, "binary"), Buffer.from(password, "utf8")]))
    .digest()

  let count = 1 << countLog2
  while (count-- > 0) {
    h = crypto
      .createHash("md5")
      .update(Buffer.concat([h, Buffer.from(password, "utf8")]))
      .digest()
  }

  const output = hash.substring(0, 12) + encode64(h, 16)
  // timing-safe equal
  if (output.length !== hash.length) return false
  return crypto.timingSafeEqual(Buffer.from(output), Buffer.from(hash))
}

/**
 * Strip WordPress's `$wp$` wrapper (added in WP 6.8 for bcrypt hashes).
 * Returns the unwrapped bcrypt hash or null if the format doesn't apply.
 * The caller should then use bcrypt.compare() for verification.
 */
export function unwrapWpBcrypt(hash: string): string | null {
  if (typeof hash !== "string") return null
  if (!hash.startsWith("$wp$")) return null
  return hash.substring(4)
}

/**
 * Convenience: pick the right verifier for a stored WordPress hash.
 * Supports portable ($P$/$H$) and WP-wrapped bcrypt ($wp$).
 * Returns false for any other format (caller should treat as no-match).
 */
export async function verifyWordPressHash(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash) return false
  const bcryptInner = unwrapWpBcrypt(storedHash)
  if (bcryptInner) {
    try {
      const bcrypt = await import("bcryptjs")
      return await bcrypt.compare(password, bcryptInner)
    } catch {
      return false
    }
  }
  return verifyPhpassPortable(password, storedHash)
}
