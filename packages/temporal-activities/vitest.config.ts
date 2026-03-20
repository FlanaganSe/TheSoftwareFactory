import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "__tests__/**/*.test.ts"],
    // Safety tests share a single Redis container via globalSetup.
    // Each test file uses a separate Redis database (db: 0-6) to
    // avoid flushdb() interference when running in parallel.
    globalSetup: ["./__tests__/safety/global-setup.ts"],
  },
});
