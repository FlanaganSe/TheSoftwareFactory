import { describe, expect, it } from "vitest";
import {
  SBOMEntrySchema,
  ValidationResultSchema,
  ValidatorControlFileEditSchema,
} from "../src/schemas/validation.js";

describe("ValidationResultSchema", () => {
  const validResult = {
    testResults: {
      passed: 10,
      failed: 0,
      skipped: 2,
      newTests: [],
      modifiedTests: [],
      deletedTests: [],
      details: [],
    },
    testCommand: "npm test",
    testExitCode: 0,
    lintResults: { errorCount: 0, warningCount: 1, details: [] },
    lintCommand: "npx biome check .",
    lintExitCode: 0,
    securityScanResults: {
      vulnerabilities: [],
      totalFindings: 0,
      criticalCount: 0,
      highCount: 0,
    },
    blastRadius: { files: 3, packages: 1 },
    filesChanged: ["src/a.ts", "src/b.ts"],
    packagesAffected: ["src"],
    protectedSurfaceEdits: [],
    migrationImpact: {
      hasMigrations: false,
      migrationFiles: [],
      schemaChanges: [],
    },
    revertabilityClass: "clean_revert" as const,
    validatorControlFileEdits: [],
    trustedContextUsed: true,
    commandsRun: [{ command: "npm test", exitCode: 0, durationMs: 3000 }],
    passed: true,
    summary: "All checks passed",
  };

  it("valid ValidationResult passes schema", () => {
    const result = ValidationResultSchema.safeParse(validResult);
    expect(result.success).toBe(true);
  });

  it("missing required fields fail", () => {
    const result = ValidationResultSchema.safeParse({
      testResults: validResult.testResults,
      // Missing most fields
    });
    expect(result.success).toBe(false);
  });

  it("extra fields are rejected (strict)", () => {
    const result = ValidationResultSchema.safeParse({
      ...validResult,
      extraField: "should fail",
    });
    expect(result.success).toBe(false);
  });
});

describe("ValidatorControlFileEditSchema", () => {
  it("validates valid categories", () => {
    const valid = {
      path: "vitest.config.ts",
      baseRefHash: "abc123",
      workspaceHash: "def456",
      category: "test_config",
    };
    expect(ValidatorControlFileEditSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid category", () => {
    const invalid = {
      path: "vitest.config.ts",
      baseRefHash: "abc123",
      workspaceHash: "def456",
      category: "invalid_category",
    };
    expect(ValidatorControlFileEditSchema.safeParse(invalid).success).toBe(
      false,
    );
  });
});

describe("SBOMEntrySchema", () => {
  it("validates valid types", () => {
    const valid = {
      name: "lodash",
      version: "4.17.21",
      type: "npm",
      license: "MIT",
    };
    expect(SBOMEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("validates all supported types", () => {
    for (const type of ["npm", "pip", "go", "cargo", "maven", "other"]) {
      const entry = { name: "pkg", version: "1.0", type };
      expect(SBOMEntrySchema.safeParse(entry).success).toBe(true);
    }
  });

  it("rejects invalid type", () => {
    const invalid = { name: "pkg", version: "1.0", type: "invalid" };
    expect(SBOMEntrySchema.safeParse(invalid).success).toBe(false);
  });
});
