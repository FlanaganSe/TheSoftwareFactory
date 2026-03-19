import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, maskApiKey } from "../src/config.js";

const TEST_DIR = join(tmpdir(), `factory-cli-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("loadConfig", () => {
  it("returns defaults when no files or env exist", () => {
    vi.stubEnv("FACTORY_API_URL", "");
    vi.stubEnv("FACTORY_API_KEY", "");

    const config = loadConfig({});
    expect(config.apiUrl).toBe("http://localhost:3000");
    expect(config.apiKey).toBeUndefined();
    expect(config.json).toBe(false);
  });

  it("env vars override defaults", () => {
    vi.stubEnv("FACTORY_API_URL", "http://custom:9000");
    vi.stubEnv("FACTORY_API_KEY", "test-key-123");

    const config = loadConfig({});
    expect(config.apiUrl).toBe("http://custom:9000");
    expect(config.apiKey).toBe("test-key-123");
  });

  it("CLI flags override env vars", () => {
    vi.stubEnv("FACTORY_API_URL", "http://env:9000");
    vi.stubEnv("FACTORY_API_KEY", "env-key");

    const config = loadConfig({
      apiUrl: "http://flag:8000",
      apiKey: "flag-key",
    });
    expect(config.apiUrl).toBe("http://flag:8000");
    expect(config.apiKey).toBe("flag-key");
  });

  it("json flag is respected", () => {
    const config = loadConfig({ json: true });
    expect(config.json).toBe(true);
  });

  it("missing config files do not error", () => {
    vi.stubEnv("XDG_CONFIG_HOME", join(TEST_DIR, "nonexistent"));
    vi.stubEnv("FACTORY_API_URL", "");
    vi.stubEnv("FACTORY_API_KEY", "");

    expect(() => loadConfig({})).not.toThrow();
  });

  it("respects XDG_CONFIG_HOME for user config", () => {
    const xdgDir = join(TEST_DIR, "xdg-config");
    const configDir = join(xdgDir, "software-factory");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.toml"),
      'api_url = "http://xdg:4000"\napi_key = "xdg-key"\n',
    );

    vi.stubEnv("XDG_CONFIG_HOME", xdgDir);
    vi.stubEnv("FACTORY_API_URL", "");
    vi.stubEnv("FACTORY_API_KEY", "");

    const config = loadConfig({});
    expect(config.apiUrl).toBe("http://xdg:4000");
    expect(config.apiKey).toBe("xdg-key");
  });
});

describe("maskApiKey", () => {
  it("masks long API keys", () => {
    expect(maskApiKey("abcd1234efgh5678")).toBe("abcd************");
  });

  it("fully masks short API keys", () => {
    expect(maskApiKey("short")).toBe("****");
  });

  it("shows not set for undefined", () => {
    expect(maskApiKey(undefined)).toBe("(not set)");
  });

  it("shows not set for empty string", () => {
    expect(maskApiKey("")).toBe("(not set)");
  });
});
