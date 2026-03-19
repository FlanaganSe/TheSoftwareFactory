import type { SetupContract } from "@software-factory/core";
import { describe, expect, it } from "vitest";
import { computeCacheKey } from "../../src/sandbox/cache.js";
import type { SandboxCacheConfig } from "../../src/sandbox/cache.js";

function makeContract(overrides?: Partial<SetupContract>): SetupContract {
  return {
    version: "1",
    image: "node:22-slim",
    setup: ["npm ci"],
    maintenance: ["npm update"],
    secrets: {
      setup_only: ["NPM_TOKEN"],
      runtime: ["DB_URL"],
      per_tool: [],
    },
    health_check: ["node --version"],
    ...overrides,
  };
}

function makeConfig(
  overrides?: Partial<SandboxCacheConfig>,
): SandboxCacheConfig {
  return {
    setupContract: makeContract(),
    secrets: {
      setupOnly: { NPM_TOKEN: "secret-value-1" },
      runtime: { DB_URL: "postgres://..." },
      perTool: {},
    },
    ...overrides,
  };
}

describe("computeCacheKey", () => {
  it("is deterministic — same input produces same hash", () => {
    const config = makeConfig();
    const key1 = computeCacheKey(config);
    const key2 = computeCacheKey(config);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
  });

  it("changes when setup commands change", () => {
    const config1 = makeConfig();
    const config2 = makeConfig({
      setupContract: makeContract({ setup: ["npm ci", "npm run build"] }),
    });
    expect(computeCacheKey(config1)).not.toBe(computeCacheKey(config2));
  });

  it("changes when image changes", () => {
    const config1 = makeConfig();
    const config2 = makeConfig({
      setupContract: makeContract({ image: "node:20-slim" }),
    });
    expect(computeCacheKey(config1)).not.toBe(computeCacheKey(config2));
  });

  it("changes when secret NAMES change", () => {
    const config1 = makeConfig();
    const config2 = makeConfig({
      secrets: {
        setupOnly: { NPM_TOKEN: "val", EXTRA_KEY: "val2" },
        runtime: { DB_URL: "postgres://..." },
        perTool: {},
      },
    });
    expect(computeCacheKey(config1)).not.toBe(computeCacheKey(config2));
  });

  it("does NOT change when secret VALUES change", () => {
    const config1 = makeConfig();
    const config2 = makeConfig({
      secrets: {
        setupOnly: { NPM_TOKEN: "completely-different-value" },
        runtime: { DB_URL: "postgres://..." },
        perTool: {},
      },
    });
    expect(computeCacheKey(config1)).toBe(computeCacheKey(config2));
  });

  it("changes when maintenance commands change", () => {
    const config1 = makeConfig();
    const config2 = makeConfig({
      setupContract: makeContract({ maintenance: ["npm update --force"] }),
    });
    expect(computeCacheKey(config1)).not.toBe(computeCacheKey(config2));
  });
});
