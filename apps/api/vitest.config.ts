import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    // Only run TS sources — `tsc` (build) emits compiled *.test.js into dist/,
    // which vitest would otherwise pick up as duplicate, broken suites.
    include: ["src/**/*.test.ts"],
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
