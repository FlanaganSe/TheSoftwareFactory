import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/!(e2e)/vitest.config.ts", "apps/*/vitest.config.ts"],
    passWithNoTests: true,
    // Limit concurrent worker processes across all workspace projects.
    // Without this, vitest uses one worker per CPU core (11 on this machine),
    // which starts too many Testcontainers/Temporal servers simultaneously.
    // See: https://vitest.dev/config/#maxworkers
    maxWorkers: "50%",
  },
});
