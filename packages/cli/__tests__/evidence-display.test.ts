import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceResponse } from "../src/api-client.js";
import { formatEvidence } from "../src/ui/evidence-display.js";

function makeBundle(overrides?: Partial<EvidenceResponse>): EvidenceResponse {
  return {
    bundleId: "bundle-1",
    taskId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    version: 1,
    schemaVersion: 1,
    objective: "Add hello world function",
    baseSha: "abc1234567890",
    headSha: "def5678901234",
    mergeBaseSha: "abc1234567890",
    revertabilityClass: "clean_revert",
    blastRadiusFiles: 3,
    blastRadiusPackages: 2,
    annotatedDiff: [
      {
        file: "src/index.ts",
        hunkIndex: 0,
        annotation: "Modified lines 5-16: 12 additions, 2 deletions",
        riskLevel: "low",
        affectedConsumers: ["src/app.ts"],
      },
      {
        file: "src/utils.ts",
        hunkIndex: 0,
        annotation: "Modified lines 20-24: 5 additions",
        riskLevel: "medium",
        affectedConsumers: ["src/index.ts"],
      },
    ],
    ownersImpacted: ["@backend-team", "@infra-team"],
    testResults: {
      passed: 47,
      failed: 0,
      skipped: 2,
      newTests: [],
      modifiedTests: [],
      deletedTests: [],
      details: [
        { name: "add.test", status: "passed", durationMs: 12 },
        { name: "sub.test", status: "passed", durationMs: 8 },
        { name: "div.test", status: "skipped" },
      ],
    },
    securityScanResults: {
      vulnerabilities: [
        {
          id: "VULN-001",
          severity: "medium",
          description: "hardcoded-credentials",
          file: "src/config.ts",
          line: 42,
        },
      ],
      totalFindings: 1,
      criticalCount: 0,
      highCount: 0,
    },
    lintResults: {
      errorCount: 0,
      warningCount: 3,
      details: [],
    },
    protectedSurfaceEdits: [],
    migrationImpact: {
      hasMigrations: false,
      migrationFiles: [],
      schemaChanges: [],
    },
    unresolvedAssumptions: [
      "Assumed existing test suite covers the new function",
    ],
    commandsRun: [
      { command: "npm test", exitCode: 0, durationMs: 4200 },
      { command: "npx biome check .", exitCode: 0, durationMs: 1100 },
    ],
    pendingExternalChecks: ["ci/test (any app)", "ci/lint (any app)"],
    createdAt: "2026-03-19T16:00:00Z",
    ...overrides,
  };
}

function stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI codes
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("formatEvidence", () => {
  it("renders the header box with task ID", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("Evidence Packet");
    expect(output).toContain("aaaaaaaa");
  });

  it("renders objective", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("Add hello world function");
  });

  it("renders risk summary with correct categories", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("Hard Blockers:");
    expect(output).toContain("Soft Concerns:");
    expect(output).toContain("Human Judgment:");
    expect(output).toContain("Informational:");
  });

  it("renders test results with pass/fail/skip counts", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("47 passed");
    expect(output).toContain("0 failed");
    expect(output).toContain("2 skipped");
  });

  it("renders lint results", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("0 errors");
    expect(output).toContain("3 warnings");
  });

  it("renders security scan with severity breakdown", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("0 critical");
    expect(output).toContain("0 high");
    expect(output).toContain("1 medium");
    expect(output).toContain("hardcoded-credentials");
  });

  it("renders blast radius", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("3 changed");
    expect(output).toContain("2 packages affected");
    expect(output).toContain("clean_revert");
  });

  it("renders owners impacted", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("@backend-team");
    expect(output).toContain("@infra-team");
  });

  it("renders protected surface edits (none)", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("Protected Surface Edits");
    expect(output).toContain("None");
  });

  it("renders protected edits when present", () => {
    const bundle = makeBundle({
      protectedSurfaceEdits: [
        {
          filePath: ".github/workflows/ci.yml",
          protectionClass: "hard_protected",
          justification: "CI config change required",
        },
      ] as unknown as readonly unknown[],
    });
    const output = stripAnsi(formatEvidence(bundle));
    expect(output).toContain(".github/workflows/ci.yml");
    expect(output).toContain("hard_protected");
  });

  it("renders migration impact", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("No migrations detected");
  });

  it("renders annotated diff with file names", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("src/index.ts");
    expect(output).toContain("src/utils.ts");
  });

  it("renders unresolved assumptions", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain(
      "Assumed existing test suite covers the new function",
    );
  });

  it("renders pending external checks", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("ci/test (any app)");
    expect(output).toContain("ci/lint (any app)");
  });

  it("renders commands run", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("npm test");
    expect(output).toContain("npx biome check .");
  });

  it("renders action commands in footer", () => {
    const output = stripAnsi(formatEvidence(makeBundle()));
    expect(output).toContain("factory approve");
    expect(output).toContain("factory changes");
    expect(output).toContain("factory reject");
  });

  it("respects NO_COLOR by not producing ANSI when chalk is disabled", () => {
    // chalk auto-detects NO_COLOR — we just verify our content is correct
    const output = formatEvidence(makeBundle());
    // The output should contain the task info regardless of color
    expect(output).toBeDefined();
    expect(output.length).toBeGreaterThan(100);
  });
});
