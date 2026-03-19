import { describe, expect, it } from "vitest";
import { buildExecEnv, buildToolExecEnv } from "../../src/sandbox/secrets.js";
import type { SecretBindings } from "../../src/sandbox/secrets.js";

const makeBindings = (overrides?: Partial<SecretBindings>): SecretBindings => ({
  setupOnly: {},
  runtime: {},
  perTool: {},
  ...overrides,
});

describe("buildExecEnv", () => {
  it("returns setup-only secrets during setup phase", () => {
    const bindings = makeBindings({
      setupOnly: { NPM_TOKEN: "tok-123", GITHUB_TOKEN: "ghp_abc" },
      runtime: { DB_URL: "postgres://..." },
    });
    const env = buildExecEnv("setup", bindings);
    expect(env).toContain("NPM_TOKEN=tok-123");
    expect(env).toContain("GITHUB_TOKEN=ghp_abc");
    expect(env).not.toContain("DB_URL=postgres://...");
  });

  it("returns runtime secrets during runtime phase", () => {
    const bindings = makeBindings({
      setupOnly: { NPM_TOKEN: "tok-123" },
      runtime: { DB_URL: "postgres://...", API_KEY: "key-456" },
    });
    const env = buildExecEnv("runtime", bindings);
    expect(env).toContain("DB_URL=postgres://...");
    expect(env).toContain("API_KEY=key-456");
    expect(env).not.toContain("NPM_TOKEN=tok-123");
  });

  it("returns empty array when no secrets for phase", () => {
    const bindings = makeBindings();
    expect(buildExecEnv("setup", bindings)).toEqual([]);
    expect(buildExecEnv("runtime", bindings)).toEqual([]);
  });
});

describe("buildToolExecEnv", () => {
  it("returns only the specific tool's secrets", () => {
    const bindings = makeBindings({
      perTool: {
        gh: { GITHUB_TOKEN: "ghp_xyz" },
        npm: { NPM_TOKEN: "tok-789" },
      },
    });
    const env = buildToolExecEnv("gh", bindings);
    expect(env).toContain("GITHUB_TOKEN=ghp_xyz");
    expect(env).not.toContain("NPM_TOKEN=tok-789");
  });

  it("returns empty array for unknown tool", () => {
    const bindings = makeBindings({
      perTool: { gh: { GITHUB_TOKEN: "ghp_xyz" } },
    });
    expect(buildToolExecEnv("unknown-tool", bindings)).toEqual([]);
  });

  it("returns empty array when perTool is empty", () => {
    const bindings = makeBindings();
    expect(buildToolExecEnv("gh", bindings)).toEqual([]);
  });
});
