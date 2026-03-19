import type { PolicyConfig } from "@software-factory/core";
import { ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import {
  classifyRisk,
  generateAnnotatedDiff,
} from "../../src/evidence/diff-annotator.js";

function makePolicy(
  patterns: string[],
  type: "edit_protected" | "edit_deny" = "edit_protected",
): PolicyConfig {
  return {
    repoId: "test-repo",
    name: "test-policy",
    policyType: type,
    protectionClass: "flagged",
    pathPatterns: patterns,
    autonomyLevel: "L1",
    requiresApproval: true,
    approverRole: "admin",
    isActive: true,
  };
}

describe("classifyRisk", () => {
  it("classifies protected file as high risk", () => {
    const policies = [makePolicy(["src/auth/**"])];
    expect(classifyRisk("src/auth/login.ts", policies)).toBe("high");
  });

  it("classifies migration file as high risk", () => {
    expect(classifyRisk("db/migrations/001_create_users.sql", [])).toBe("high");
  });

  it("classifies security-critical path as high risk", () => {
    expect(classifyRisk("src/auth/jwt-validator.ts", [])).toBe("high");
  });

  it("classifies test file as low risk", () => {
    expect(classifyRisk("src/__tests__/utils.test.ts", [])).toBe("low");
  });

  it("classifies spec file as low risk", () => {
    expect(classifyRisk("tests/api.spec.ts", [])).toBe("low");
  });

  it("classifies documentation as low risk", () => {
    expect(classifyRisk("docs/readme.md", [])).toBe("low");
  });

  it("classifies package.json as medium risk", () => {
    expect(classifyRisk("package.json", [])).toBe("medium");
  });

  it("classifies API handler as medium risk", () => {
    expect(classifyRisk("src/api/users.ts", [])).toBe("medium");
  });

  it("classifies regular source file as medium risk (default)", () => {
    expect(classifyRisk("src/utils/format.ts", [])).toBe("medium");
  });
});

describe("generateAnnotatedDiff", () => {
  it("returns empty annotations for empty diff", async () => {
    const sandbox = {
      execCommand: async () =>
        ok({ exitCode: 0, stdout: "", stderr: "", durationMs: 10 }),
    } as never;

    const result = await generateAnnotatedDiff(
      { containerId: "test-container", sandbox, baseSha: "abc123" },
      [],
      new Map(),
    );

    expect(result.annotations).toHaveLength(0);
    expect(result.rawPatch).toBe("");
  });

  it("parses a simple single-file diff into annotations", async () => {
    const diffOutput = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -10,3 +10,5 @@ export function main() {
   const x = 1;
+  const y = 2;
+  const z = 3;
   return x;
`;

    const sandbox = {
      execCommand: async () =>
        ok({ exitCode: 0, stdout: diffOutput, stderr: "", durationMs: 10 }),
    } as never;

    const result = await generateAnnotatedDiff(
      { containerId: "test-container", sandbox, baseSha: "abc123" },
      [],
      new Map(),
    );

    expect(result.annotations.length).toBeGreaterThanOrEqual(1);
    expect(result.annotations[0].file).toBe("src/index.ts");
    expect(result.annotations[0].hunkIndex).toBe(0);
    expect(result.annotations[0].annotation).toContain("2 additions");
    expect(result.annotations[0].riskLevel).toBe("medium");
  });

  it("annotates multi-file diffs with per-file annotations", async () => {
    const diffOutput = `diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,4 @@
 import express from 'express';
+import cors from 'cors';
 const app = express();
diff --git a/tests/api.test.ts b/tests/api.test.ts
--- a/tests/api.test.ts
+++ b/tests/api.test.ts
@@ -5,3 +5,5 @@
 describe('api', () => {
+  it('uses cors', () => {});
+  it('validates input', () => {});
 });
`;

    const sandbox = {
      execCommand: async () =>
        ok({ exitCode: 0, stdout: diffOutput, stderr: "", durationMs: 10 }),
    } as never;

    const result = await generateAnnotatedDiff(
      { containerId: "test-container", sandbox, baseSha: "abc123" },
      [],
      new Map(),
    );

    const files = new Set(result.annotations.map((a) => a.file));
    expect(files.size).toBe(2);
    expect(files.has("src/api.ts")).toBe(true);
    expect(files.has("tests/api.test.ts")).toBe(true);
  });

  it("marks protected file edits with [PROTECTED] annotation", async () => {
    const diffOutput = `diff --git a/src/auth/login.ts b/src/auth/login.ts
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -1,3 +1,4 @@
 export function login() {
+  // new login logic
 }
`;

    const policies = [makePolicy(["src/auth/**"])];
    const sandbox = {
      execCommand: async () =>
        ok({ exitCode: 0, stdout: diffOutput, stderr: "", durationMs: 10 }),
    } as never;

    const result = await generateAnnotatedDiff(
      { containerId: "test-container", sandbox, baseSha: "abc123" },
      policies,
      new Map(),
    );

    expect(result.annotations.length).toBeGreaterThanOrEqual(1);
    expect(result.annotations[0].riskLevel).toBe("high");
    expect(result.annotations[0].annotation).toContain("[PROTECTED:");
  });

  it("includes affected consumers from the map", async () => {
    const diffOutput = `diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,4 @@
 export function helper() {
+  return 42;
 }
`;

    const consumers = new Map([
      ["src/utils.ts", ["src/api.ts", "src/handler.ts"]],
    ]);

    const sandbox = {
      execCommand: async () =>
        ok({ exitCode: 0, stdout: diffOutput, stderr: "", durationMs: 10 }),
    } as never;

    const result = await generateAnnotatedDiff(
      { containerId: "test-container", sandbox, baseSha: "abc123" },
      [],
      consumers,
    );

    expect(result.annotations[0].affectedConsumers).toEqual([
      "src/api.ts",
      "src/handler.ts",
    ]);
  });
});
