import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "__tests__/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Workflow tests create TestWorkflowEnvironment instances (full Temporal
    // test servers with gRPC). Running files in parallel causes resource
    // contention and gRPC teardown errors.
    //
    // Note: fileParallelism is a root-level-only setting in vitest and does
    // NOT work at the project level (vitest#5933). The supported per-project
    // workaround is pool: "forks" + singleFork: true (vitest#7416), which
    // forces all test files in this project to run in a single sequential fork.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
