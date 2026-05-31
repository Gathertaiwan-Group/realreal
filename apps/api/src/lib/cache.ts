/**
 * Generic TTL Map cache.
 *
 * Module-level Map keyed by string. Each entry stores a value and an
 * absolute expiry timestamp (ms). On read, expired entries are treated
 * as misses and re-loaded.
 */

export type CacheEntry<T> = { value: T; expiresAt: number }

const store = new Map<string, CacheEntry<unknown>>()

/**
 * Returns the cached value for `key` if it's still fresh; otherwise
 * awaits `loader()`, stores the result with `ttlMs` of life, and returns it.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.expiresAt > now) {
    return hit.value as T
  }
  const value = await loader()
  store.set(key, { value, expiresAt: now + ttlMs })
  return value
}

export function invalidateCache(key: string): void {
  store.delete(key)
}
