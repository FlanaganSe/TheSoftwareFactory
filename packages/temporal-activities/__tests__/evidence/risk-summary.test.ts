import type {
  DiffAnnotation,
  ValidatorControlFileEdit,
} from "@software-factory/core";
import { describe, expect, it } from "vitest";
import { categorizeRisks } from "../../src/evidence/risk-summary.js";

function makeValidation(
  overrides: Partial<Parameters<typeof categorizeRisks>[0]> = {},
) {
  return {
    testsPassed: true,
    testFailCount: 0,
    criticalVulnCount: 0,
    highVulnCount: 0,
    mediumVulnCount: 0,
    lintErrorCount: 0,
    lintWarningCount: 0,
    hasMigrations: false,
    protectedSurfaceEdits: [] as string[],
    ...overrides,
  };
}

function makeAnnotation(riskLevel: "low" | "medium" | "high"): DiffAnnotation {
  return {
    file: "src/test.ts",
    hunkIndex: 0,
    annotation: "test annotation",
    riskLevel,
    affectedConsumers: [],
  };
}

function makeControlFileEdit(): ValidatorControlFileEdit {
  return {
    path: "vitest.config.ts",
    baseRefHash: "abc123",
    workspaceHash: "def456",
    category: "test_config",
  };
}

describe("categorizeRisks", () => {
  it("flags test failures as hard blockers", () => {
    const result = categorizeRisks(
      makeValidation({ testsPassed: false, testFailCount: 3 }),
      [],
      [],
    );
    expect(result.hardBlockers.length).toBeGreaterThan(0);
    expect(result.hardBlockers[0]).toContain("3 test(s) failed");
  });

  it("flags critical security vulnerabilities as hard blockers", () => {
    const result = categorizeRisks(
      makeValidation({ criticalVulnCount: 2 }),
      [],
      [],
    );
    expect(result.hardBlockers.length).toBeGreaterThan(0);
    expect(result.hardBlockers[0]).toContain("2 critical");
  });

  it("flags protected surface edits as soft concerns", () => {
    const result = categorizeRisks(
      makeValidation({ protectedSurfaceEdits: ["src/auth/config.ts"] }),
      [],
      [],
    );
    expect(result.softConcerns.length).toBeGreaterThan(0);
    expect(
      result.softConcerns.some((c) => c.includes("protected surface")),
    ).toBe(true);
  });

  it("flags validator control file edits as human judgment required", () => {
    const result = categorizeRisks(
      makeValidation(),
      [],
      [makeControlFileEdit()],
    );
    expect(result.humanJudgmentRequired.length).toBeGreaterThan(0);
    expect(
      result.humanJudgmentRequired.some((c) => c.includes("control file")),
    ).toBe(true);
  });

  it("flags migration impact as human judgment required", () => {
    const result = categorizeRisks(
      makeValidation({ hasMigrations: true }),
      [],
      [],
    );
    expect(result.humanJudgmentRequired.length).toBeGreaterThan(0);
    expect(
      result.humanJudgmentRequired.some((c) => c.includes("Migration")),
    ).toBe(true);
  });

  it("flags lint warnings as informational", () => {
    const result = categorizeRisks(
      makeValidation({ lintWarningCount: 5 }),
      [],
      [],
    );
    expect(result.informational.length).toBeGreaterThan(0);
    expect(result.informational.some((i) => i.includes("5 lint warning"))).toBe(
      true,
    );
  });

  it("returns all categories empty when no issues", () => {
    const result = categorizeRisks(makeValidation(), [], []);
    expect(result.hardBlockers).toHaveLength(0);
    expect(result.softConcerns).toHaveLength(0);
    expect(result.humanJudgmentRequired).toHaveLength(0);
    expect(result.informational).toHaveLength(0);
  });

  it("counts high-risk annotations as soft concerns", () => {
    const annotations = [makeAnnotation("high"), makeAnnotation("high")];
    const result = categorizeRisks(makeValidation(), annotations, []);
    expect(result.softConcerns.some((c) => c.includes("2 high-risk"))).toBe(
      true,
    );
  });

  it("counts low-risk annotations as informational", () => {
    const annotations = [
      makeAnnotation("low"),
      makeAnnotation("low"),
      makeAnnotation("low"),
    ];
    const result = categorizeRisks(makeValidation(), annotations, []);
    expect(result.informational.some((i) => i.includes("3 low-risk"))).toBe(
      true,
    );
  });
});
