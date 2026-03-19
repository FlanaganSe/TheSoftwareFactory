import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "__tests__/**/*.test.ts"],
    // Shared Redis container for safety primitive tests.
    // Follows the Testcontainers globalSetup pattern:
    // https://node.testcontainers.org/quickstart/global-setup/
    globalSetup: ["./__tests__/safety/global-setup.ts"],
  },
});
