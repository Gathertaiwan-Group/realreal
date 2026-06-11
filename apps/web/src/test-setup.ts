import "@testing-library/jest-dom"

// jsdom's localStorage is missing/partial under this vitest setup, which breaks
// zustand's persist middleware ("storage.setItem is not a function") and made
// the cart store tests fail. Provide a simple Map-backed Storage polyfill.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() { return this.store.size }
  clear() { this.store.clear() }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string) { this.store.set(key, String(value)) }
  removeItem(key: string) { this.store.delete(key) }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null }
}

if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.setItem !== "function"
) {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  })
}
