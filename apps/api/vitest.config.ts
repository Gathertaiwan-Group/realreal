import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Corrects supertest's bind/connect address-family mismatch (it binds the
    // dual-stack wildcard but dials 127.0.0.1), which let an unrelated local
    // process holding the same ephemeral port on the IPv4 loopback answer our
    // requests. See vitest.setup.ts for the full mechanism and measurements.
    setupFiles: ["./vitest.setup.ts"],
    // Only run TS sources — `tsc` (build) emits compiled *.test.js into dist/,
    // which vitest would otherwise pick up as duplicate, broken suites.
    //
    // BOTH roots must be listed: suites live in src/**/__tests__/ AND in this
    // package's top-level test/ dir. The glob used to be "src/**/*.test.ts"
    // only, which silently skipped all four test/*.test.ts suites (65 cases,
    // covering order cancellation + campaign evaluation) — they had never run,
    // locally or in CI, because a non-matching include is not an error.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    env: {
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      INTERNAL_API_SECRET: "test-internal-secret",
      TOKEN_ENCRYPTION_KEY: "test-encryption-key-32-chars-long!",
      PCHOMEPAY_HASH_KEY: "test-hash-key",
      PCHOMEPAY_HASH_IV: "test-hash-iv",
    },
  },
})
