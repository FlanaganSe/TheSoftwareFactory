import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCLUSIONS,
  evaluateChangedPaths,
  evaluatePath,
  isGovernanceExcluded,
} from "../src/policy/decision-service.js";
import type { PolicyConfig } from "../src/schemas/policy.js";

const makePolicy = (overrides: Partial<PolicyConfig>): PolicyConfig => ({
  repoId: "550e8400-e29b-41d4-a716-446655440000",
  name: "test-policy",
  policyType: "edit_allowed",
  protectionClass: null,
  pathPatterns: ["src/**"],
  autonomyLevel: "L1",
  requiresApproval: false,
  approverRole: null,
  isActive: true,
  ...overrides,
});

describe("DEFAULT_EXCLUSIONS", () => {
  it("contains all required exclusion patterns", () => {
    expect(DEFAULT_EXCLUSIONS).toContain("secrets/**");
    expect(DEFAULT_EXCLUSIONS).toContain(".env*");
    expect(DEFAULT_EXCLUSIONS).toContain("*.pem");
    expect(DEFAULT_EXCLUSIONS).toContain("*.key");
    expect(DEFAULT_EXCLUSIONS).toContain(".git/**");
    expect(DEFAULT_EXCLUSIONS).toContain("node_modules/**");
  });
});

describe("isGovernanceExcluded", () => {
  it.each([
    "secrets/api-key.json",
    ".env",
    ".env.local",
    ".env.production",
    "cert.pem",
    "server.key",
    "keystore.p12",
    "cert.pfx",
    "trust.jks",
    ".git/config",
    ".git/objects/pack/some-pack",
    "node_modules/lodash/index.js",
  ])("blocks default-excluded path: %s", (path) => {
    expect(isGovernanceExcluded(path)).toBe(true);
  });

  it.each([
    "src/index.ts",
    "packages/core/src/schemas/task.ts",
    "README.md",
    "package.json",
  ])("allows normal source file: %s", (path) => {
    expect(isGovernanceExcluded(path)).toBe(false);
  });
});

describe("evaluatePath", () => {
  it("denies read on governance-excluded path", () => {
    const decision = evaluatePath("secrets/api-key.json", "read", []);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("governance exclusion");
  });

  it("allows read on path with no matching policy", () => {
    const decision = evaluatePath("src/index.ts", "read", []);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it("denies read on path matching read_exclusion policy", () => {
    const policies = [
      makePolicy({
        name: "secret-files",
        policyType: "read_exclusion",
        pathPatterns: ["config/secrets/**"],
      }),
    ];
    const decision = evaluatePath("config/secrets/db.json", "read", policies);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Read exclusion");
  });

  it("denies write on path matching edit_deny policy", () => {
    const policies = [
      makePolicy({
        name: "deny-workflows",
        policyType: "edit_deny",
        protectionClass: "hard_protected",
        pathPatterns: [".github/workflows/**"],
      }),
    ];
    const decision = evaluatePath(
      ".github/workflows/ci.yml",
      "write",
      policies,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.protectionClass).toBe("hard_protected");
  });

  it("allows write on path matching edit_protected with requiresApproval", () => {
    const policies = [
      makePolicy({
        name: "protected-tests",
        policyType: "edit_protected",
        protectionClass: "flagged",
        pathPatterns: ["**/*.test.ts"],
        requiresApproval: true,
      }),
    ];
    const decision = evaluatePath("src/auth.test.ts", "write", policies);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.protectionClass).toBe("flagged");
  });

  it("allows write on path matching edit_allowed policy", () => {
    const policies = [
      makePolicy({
        policyType: "edit_allowed",
        pathPatterns: ["src/**"],
      }),
    ];
    const decision = evaluatePath("src/index.ts", "write", policies);
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
  });

  it("ignores inactive policies", () => {
    const policies = [
      makePolicy({
        policyType: "edit_deny",
        pathPatterns: ["src/**"],
        isActive: false,
      }),
    ];
    const decision = evaluatePath("src/index.ts", "write", policies);
    expect(decision.allowed).toBe(true);
  });

  it("read_exclusion blocks index operation", () => {
    const policies = [
      makePolicy({
        policyType: "read_exclusion",
        pathPatterns: ["private/**"],
      }),
    ];
    const decision = evaluatePath("private/data.json", "index", policies);
    expect(decision.allowed).toBe(false);
  });

  it("read_exclusion blocks search operation", () => {
    const policies = [
      makePolicy({
        policyType: "read_exclusion",
        pathPatterns: ["private/**"],
      }),
    ];
    const decision = evaluatePath("private/data.json", "search", policies);
    expect(decision.allowed).toBe(false);
  });
});

describe("evaluateChangedPaths", () => {
  it("returns denial for any path matching deny policy", () => {
    const policies = [
      makePolicy({
        policyType: "edit_deny",
        pathPatterns: [".github/workflows/**"],
      }),
    ];
    const decisions = evaluateChangedPaths(
      ["src/index.ts", ".github/workflows/ci.yml"],
      policies,
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[0].allowed).toBe(true);
    expect(decisions[1].allowed).toBe(false);
  });
});

describe("picomatch glob patterns", () => {
  it("matches **/*.pem", () => {
    expect(isGovernanceExcluded("certs/server.pem", ["**/*.pem"])).toBe(true);
  });

  it("matches secrets/**", () => {
    expect(
      isGovernanceExcluded("secrets/deep/nested.json", ["secrets/**"]),
    ).toBe(true);
  });

  it("matches .env*", () => {
    expect(isGovernanceExcluded(".env.staging", [".env*"])).toBe(true);
    expect(isGovernanceExcluded(".env", [".env*"])).toBe(true);
  });

  it("does not match unrelated patterns", () => {
    expect(isGovernanceExcluded("src/main.ts", ["**/*.pem"])).toBe(false);
  });
});

describe("policy priority", () => {
  it("edit_deny takes precedence over edit_allowed for same path", () => {
    const policies = [
      makePolicy({
        name: "allow-src",
        policyType: "edit_allowed",
        pathPatterns: ["**"],
      }),
      makePolicy({
        name: "deny-workflows",
        policyType: "edit_deny",
        pathPatterns: [".github/workflows/**"],
      }),
    ];
    const decision = evaluatePath(
      ".github/workflows/ci.yml",
      "write",
      policies,
    );
    expect(decision.allowed).toBe(false);
  });
});
