import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // @ts-expect-error -- Vite 6/7 plugin type mismatch (SvelteKit uses Vite 6, vitest uses 7)
  plugins: [svelteTesting()],
  test: {
    include: ["src/**/*.test.ts", "src/**/__tests__/*.test.ts"],
    environment: "jsdom",
    setupFiles: ["./vitest-setup.ts"],
    passWithNoTests: true,
    alias: {
      "$lib": new URL("./src/lib", import.meta.url).pathname,
      "$app/environment": new URL("./src/__mocks__/app-environment.ts", import.meta.url).pathname,
      "$app/navigation": new URL("./src/__mocks__/app-navigation.ts", import.meta.url).pathname,
      "$app/state": new URL("./src/__mocks__/app-state.ts", import.meta.url).pathname,
    },
  },
});
