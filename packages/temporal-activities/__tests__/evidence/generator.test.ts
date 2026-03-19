import { EvidenceBundleSchema } from "@software-factory/core";
import type { CodeownersEntry } from "@software-factory/core";
import { ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import { generateEvidence } from "../../src/evidence/generator.js";
import type { EvidenceGeneratorConfig } from "../../src/evidence/generator.js";

const TASK_ID = "00000000-0000-0000-0000-000000000001";

function makeConfig(
  overrides?: Partial<EvidenceGeneratorConfig>,
): EvidenceGeneratorConfig {
  const mockSandbox = {
    execCommand: async () =>
      ok({
        exitCode: 0,
        stdout: `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export function main() {
+  return 42;
 }
`,
        stderr: "",
        durationMs: 50,
      }),
  } as never;

  return {
    taskId: TASK_ID,
    objective: "Add feature X",
    attemptNumber: 1,
    baseSha: "abc123",
    headSha: "def456",
    mergeBaseSha: "abc123",
    validationResult: {
      testResults: { passed: 10, failed: 0, skipped: 1 },
      lintResults: { errorCount: 0, warningCount: 2 },
      securityScanResults: {
        vulnerabilities: [],
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
      },
      blastRadius: { files: 3, packages: 1 },
      protectedSurfaceEdits: [],
      migrationImpact: {
        hasMigrations: false,
        migrationFiles: [],
        schemaChanges: [],
      },
      revertabilityClass: "clean_revert",
      commandsRun: [{ command: "npm test", exitCode: 0, durationMs: 5000 }],
    },
    agentResult: {
      filesModified: ["src/index.ts"],
      totalCostCents: 15,
    },
    capabilitySnapshot: {
      requiredStatusChecks: [{ context: "ci/test" }],
    },
    codeownersEntries: [],
    changedFiles: ["src/index.ts"],
    policies: [],
    sandbox: mockSandbox,
    containerId: "test-container-id",
    ...overrides,
  };
}

describe("generateEvidence", () => {
  it("generates a valid EvidenceBundle passing Zod validation", async () => {
    const config = makeConfig();
    const result = await generateEvidence(config);

    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();
    const validation = EvidenceBundleSchema.safeParse(bundle);
    expect(validation.success).toBe(true);
  });

  it("includes all 13 R-008 fields", async () => {
    const result = await generateEvidence(makeConfig());
    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();

    // All 13 R-008 fields
    expect(bundle.objective).toBe("Add feature X");
    expect(bundle.annotatedDiff).toBeDefined();
    expect(bundle.blastRadius).toEqual({ files: 3, packages: 1 });
    expect(bundle.ownersImpacted).toBeDefined();
    expect(bundle.testResults).toBeDefined();
    expect(bundle.securityScanResults).toBeDefined();
    expect(bundle.lintResults).toBeDefined();
    expect(bundle.protectedSurfaceEdits).toBeDefined();
    expect(bundle.migrationImpact).toBeDefined();
    expect(bundle.revertabilityClass).toBe("clean_revert");
    expect(bundle.unresolvedAssumptions).toBeDefined();
    expect(bundle.commandsRun).toBeDefined();
    expect(bundle.pendingExternalChecks).toBeDefined();
  });

  it("computes ownersImpacted from CODEOWNERS entries", async () => {
    const codeownersEntries: CodeownersEntry[] = [
      { pattern: "src/**", owners: ["@team-core"], lineNumber: 1 },
    ];
    const result = await generateEvidence(makeConfig({ codeownersEntries }));

    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();
    expect(bundle.ownersImpacted).toContain("@team-core");
  });

  it("derives pendingExternalChecks from capability snapshot", async () => {
    const result = await generateEvidence(
      makeConfig({
        capabilitySnapshot: {
          requiredStatusChecks: [
            { context: "ci/test" },
            { context: "ci/build" },
          ],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();
    expect(bundle.pendingExternalChecks).toContain("ci/test");
    expect(bundle.pendingExternalChecks).toContain("ci/build");
  });

  it("includes unresolvedAssumptions from agent result", async () => {
    const result = await generateEvidence(
      makeConfig({
        agentResult: {
          filesModified: ["src/index.ts"],
          totalCostCents: 10,
          unresolvedAssumptions: [
            "Assumed users table exists",
            "Assumed API key format",
          ],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();
    expect(bundle.unresolvedAssumptions).toContain(
      "Assumed users table exists",
    );
    expect(bundle.unresolvedAssumptions).toContain("Assumed API key format");
  });

  it("merges commandsRun from validation and agent", async () => {
    const result = await generateEvidence(
      makeConfig({
        agentResult: {
          filesModified: ["src/index.ts"],
          totalCostCents: 10,
          commandsRun: [
            { command: "cat file.ts", exitCode: 0, durationMs: 100 },
          ],
        },
      }),
    );

    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();
    // Should contain both validation commands and agent commands
    expect(bundle.commandsRun.length).toBeGreaterThanOrEqual(2);
  });

  it("sets schemaVersion to 1", async () => {
    const result = await generateEvidence(makeConfig());
    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();
    expect(bundle.schemaVersion).toBe(1);
  });

  it("populates metadata fields correctly", async () => {
    const result = await generateEvidence(makeConfig());
    expect(result.isOk()).toBe(true);
    const { bundle } = result._unsafeUnwrap();
    expect(bundle.taskId).toBe(TASK_ID);
    expect(bundle.attemptNumber).toBe(1);
    expect(bundle.baseSha).toBe("abc123");
    expect(bundle.headSha).toBe("def456");
    expect(bundle.createdAt).toBeTruthy();
  });
});
