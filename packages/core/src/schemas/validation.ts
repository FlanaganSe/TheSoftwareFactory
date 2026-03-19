import { z } from "zod";
import {
  BlastRadiusSchema,
  CommandRecordSchema,
  LintResultsSchema,
  MigrationImpactSchema,
  RevertabilityClassSchema,
  SecurityScanResultsSchema,
  TestResultsSchema,
} from "./evidence.js";

export const SBOMEntrySchema = z
  .object({
    name: z.string(),
    version: z.string(),
    type: z.enum(["npm", "pip", "go", "cargo", "maven", "other"]),
    license: z.string().optional(),
  })
  .strict();

export type SBOMEntry = z.infer<typeof SBOMEntrySchema>;

export const SBOMResultSchema = z
  .object({
    entries: z.array(SBOMEntrySchema),
    format: z.literal("spdx"),
    generatedAt: z.string().datetime(),
  })
  .strict();

export type SBOMResult = z.infer<typeof SBOMResultSchema>;

export const ValidatorControlFileEditSchema = z
  .object({
    path: z.string(),
    baseRefHash: z.string(),
    workspaceHash: z.string(),
    category: z.enum([
      "test_config",
      "lint_config",
      "security_config",
      "ci_config",
      "factory_config",
    ]),
  })
  .strict();

export type ValidatorControlFileEdit = z.infer<
  typeof ValidatorControlFileEditSchema
>;

export const ValidationResultSchema = z
  .object({
    // Test results
    testResults: TestResultsSchema,
    testCommand: z.string(),
    testExitCode: z.number().int(),

    // Lint results
    lintResults: LintResultsSchema,
    lintCommand: z.string(),
    lintExitCode: z.number().int(),

    // Security scan (SAST)
    securityScanResults: SecurityScanResultsSchema,
    sarifOutput: z.string().optional(),

    // SBOM
    sbom: SBOMResultSchema.optional(),

    // Vulnerability scan (on dependencies)
    vulnerabilityScan: SecurityScanResultsSchema.optional(),

    // Blast radius
    blastRadius: BlastRadiusSchema,
    filesChanged: z.array(z.string()),
    packagesAffected: z.array(z.string()),
    protectedSurfaceEdits: z.array(z.string()),

    // Migration impact
    migrationImpact: MigrationImpactSchema,

    // Revertability
    revertabilityClass: RevertabilityClassSchema,

    // Validator boundary integrity
    validatorControlFileEdits: z.array(ValidatorControlFileEditSchema),
    trustedContextUsed: z.boolean(),

    // Commands run (for evidence R-008 field 12)
    commandsRun: z.array(CommandRecordSchema),

    // Overall
    passed: z.boolean(),
    summary: z.string(),
  })
  .strict();

export type ValidationResult = z.infer<typeof ValidationResultSchema>;
