import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Tests always use .env.test (the movie_memory_test database), never .env.
// TEST_DATABASE_URL, if set, points them at a different test database (e.g. in CI).
const testEnv = config({ path: ".env.test", processEnv: {} }).parsed ?? {};
if (process.env.TEST_DATABASE_URL) testEnv.DATABASE_URL = process.env.TEST_DATABASE_URL;
Object.assign(process.env, testEnv);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // "server-only" throws outside Next's server bundle; it's a no-op in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    env: testEnv,
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // All files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
