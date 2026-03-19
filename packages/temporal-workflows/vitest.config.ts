import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "__tests__/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Each test file creates a TestWorkflowEnvironment (a full Temporal test server).
    // Running files in parallel causes resource contention and gRPC teardown errors.
    // Sequential execution is the recommended pattern for Temporal workflow tests.
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
