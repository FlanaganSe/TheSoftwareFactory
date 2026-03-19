import type { PolicyConfig } from "@software-factory/core";
import { describe, expect, it } from "vitest";
import { filterPaths } from "../../src/indexing/governance-filter.js";

function makePolicy(
  overrides: Partial<PolicyConfig> & { pathPatterns: string[] },
): PolicyConfig {
  const { pathPatterns, ...rest } = overrides;
  return {
    repoId: "test-repo-id",
    name: "test-policy",
    policyType: "read_exclusion",
    protectionClass: null,
    pathPatterns,
    autonomyLevel: "L1",
    requiresApproval: false,
    approverRole: null,
    isActive: true,
    ...rest,
  };
}

describe("filterPaths", () => {
  const repoRoot = "/tmp/test-repo";

  describe("default exclusions", () => {
    it("blocks secrets/**", () => {
      const result = filterPaths(["secrets/key.pem"], [], repoRoot);
      expect(result.excluded).toContain("secrets/key.pem");
      expect(result.included).not.toContain("secrets/key.pem");
    });

    it("blocks .env.local", () => {
      const result = filterPaths([".env.local"], [], repoRoot);
      expect(result.excluded).toContain(".env.local");
    });

    it("blocks node_modules/foo/bar.js", () => {
      const result = filterPaths(["node_modules/foo/bar.js"], [], repoRoot);
      expect(result.excluded).toContain("node_modules/foo/bar.js");
    });

    it("blocks .git/config", () => {
      const result = filterPaths([".git/config"], [], repoRoot);
      expect(result.excluded).toContain(".git/config");
    });

    it("blocks server.key at root level", () => {
      const result = filterPaths(["server.key"], [], repoRoot);
      expect(result.excluded).toContain("server.key");
    });

    it("allows src/index.ts", () => {
      const result = filterPaths(["src/index.ts"], [], repoRoot);
      expect(result.included).toContain("src/index.ts");
      expect(result.excluded).not.toContain("src/index.ts");
    });

    it("allows README.md", () => {
      const result = filterPaths(["README.md"], [], repoRoot);
      expect(result.included).toContain("README.md");
    });

    it("allows package.json", () => {
      const result = filterPaths(["package.json"], [], repoRoot);
      expect(result.included).toContain("package.json");
    });
  });

  describe("repo-specific read_exclusion policies", () => {
    it("blocks paths matching policy patterns", () => {
      const policy = makePolicy({
        pathPatterns: ["internal/**"],
        policyType: "read_exclusion",
      });

      const result = filterPaths(
        ["internal/secret.ts", "src/public.ts"],
        [policy],
        repoRoot,
      );
      expect(result.excluded).toContain("internal/secret.ts");
      expect(result.included).toContain("src/public.ts");
    });

    it("applies only active policies", () => {
      const policy = makePolicy({
        pathPatterns: ["internal/**"],
        policyType: "read_exclusion",
        isActive: false,
      });

      const result = filterPaths(["internal/secret.ts"], [policy], repoRoot);
      expect(result.included).toContain("internal/secret.ts");
    });
  });

  describe("empty policies", () => {
    it("applies only default exclusions with empty policies", () => {
      const result = filterPaths(
        ["src/index.ts", ".env", "node_modules/x.js"],
        [],
        repoRoot,
      );
      expect(result.included).toEqual(["src/index.ts"]);
      expect(result.excluded).toHaveLength(2);
    });
  });

  describe("exclusion reasons", () => {
    it("populates exclusion reasons for each excluded path", () => {
      const result = filterPaths(
        [".env.local", "secrets/api.key", "src/index.ts"],
        [],
        repoRoot,
      );

      expect(result.exclusionReasons.size).toBe(2);
      expect(result.exclusionReasons.has(".env.local")).toBe(true);
      expect(result.exclusionReasons.has("secrets/api.key")).toBe(true);
      expect(result.exclusionReasons.has("src/index.ts")).toBe(false);
    });
  });

  describe("case sensitivity", () => {
    it(".ENV is NOT excluded (only .env* matches lowercase)", () => {
      const result = filterPaths([".ENV"], [], repoRoot);
      expect(result.included).toContain(".ENV");
    });
  });

  describe("mixed paths", () => {
    it("correctly partitions a mix of included and excluded paths", () => {
      const paths = [
        "src/index.ts",
        "src/utils.ts",
        ".env",
        ".env.local",
        "node_modules/lodash/index.js",
        "secrets/private.key",
        ".git/HEAD",
        "README.md",
        "package.json",
        "server.pem",
      ];

      const result = filterPaths(paths, [], repoRoot);
      expect(result.included).toEqual([
        "src/index.ts",
        "src/utils.ts",
        "README.md",
        "package.json",
      ]);
      expect(result.excluded).toHaveLength(6);
    });
  });
});
