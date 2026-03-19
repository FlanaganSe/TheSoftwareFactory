import { z } from "zod";
import { ProtectionClassSchema } from "./policy.js";

export const RISK_LEVELS = ["low", "medium", "high"] as const;

export const RiskLevelSchema = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const DiffAnnotationSchema = z
  .object({
    file: z.string().min(1),
    hunkIndex: z.number().int().nonnegative(),
    annotation: z.string().min(1),
    riskLevel: RiskLevelSchema,
    affectedConsumers: z.array(z.string()),
  })
  .strict();

export type DiffAnnotation = z.infer<typeof DiffAnnotationSchema>;

export const TestDetailSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(["passed", "failed", "skipped"]),
    durationMs: z.number().nonnegative().optional(),
    errorMessage: z.string().optional(),
  })
  .strict();

export type TestDetail = z.infer<typeof TestDetailSchema>;

export const TestResultsSchema = z
  .object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    newTests: z.array(z.string()),
    modifiedTests: z.array(z.string()),
    deletedTests: z.array(z.string()),
    details: z.array(TestDetailSchema),
  })
  .strict();

export type TestResults = z.infer<typeof TestResultsSchema>;

export const VulnerabilitySchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["critical", "high", "medium", "low"]),
    description: z.string().min(1),
    file: z.string().optional(),
    line: z.number().int().nonnegative().optional(),
  })
  .strict();

export type Vulnerability = z.infer<typeof VulnerabilitySchema>;

export const SecurityScanResultsSchema = z
  .object({
    vulnerabilities: z.array(VulnerabilitySchema),
    totalFindings: z.number().int().nonnegative(),
    criticalCount: z.number().int().nonnegative(),
    highCount: z.number().int().nonnegative(),
  })
  .strict();

export type SecurityScanResults = z.infer<typeof SecurityScanResultsSchema>;

export const LintDetailSchema = z
  .object({
    file: z.string().min(1),
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    rule: z.string().min(1),
    severity: z.enum(["error", "warning"]),
    message: z.string().min(1),
  })
  .strict();

export type LintDetail = z.infer<typeof LintDetailSchema>;

export const LintResultsSchema = z
  .object({
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    details: z.array(LintDetailSchema),
  })
  .strict();

export type LintResults = z.infer<typeof LintResultsSchema>;

export const ProtectedEditSchema = z
  .object({
    filePath: z.string().min(1),
    protectionClass: ProtectionClassSchema,
    justification: z.string().min(1),
    beforeContent: z.string().optional(),
    afterContent: z.string().optional(),
  })
  .strict();

export type ProtectedEdit = z.infer<typeof ProtectedEditSchema>;

export const MigrationImpactSchema = z
  .object({
    hasMigrations: z.boolean(),
    migrationFiles: z.array(z.string()),
    schemaChanges: z.array(z.string()),
  })
  .strict();

export type MigrationImpact = z.infer<typeof MigrationImpactSchema>;

export const CommandRecordSchema = z
  .object({
    command: z.string().min(1),
    exitCode: z.number().int(),
    durationMs: z.number().nonnegative(),
    output: z.string().optional(),
  })
  .strict();

export type CommandRecord = z.infer<typeof CommandRecordSchema>;

export const REVERTABILITY_CLASSES = [
  "clean_revert",
  "revert_with_migration",
  "non_revertable",
] as const;

export const RevertabilityClassSchema = z.enum(REVERTABILITY_CLASSES);
export type RevertabilityClass = z.infer<typeof RevertabilityClassSchema>;

export const BlastRadiusSchema = z
  .object({
    files: z.number().int().nonnegative(),
    packages: z.number().int().nonnegative(),
  })
  .strict();

export type BlastRadius = z.infer<typeof BlastRadiusSchema>;

export const EvidenceBundleSchema = z
  .object({
    // 13 PRD R-008 fields
    objective: z.string().min(1),
    annotatedDiff: z.array(DiffAnnotationSchema),
    blastRadius: BlastRadiusSchema,
    ownersImpacted: z.array(z.string()),
    testResults: TestResultsSchema,
    securityScanResults: SecurityScanResultsSchema,
    lintResults: LintResultsSchema,
    protectedSurfaceEdits: z.array(ProtectedEditSchema),
    migrationImpact: MigrationImpactSchema,
    revertabilityClass: RevertabilityClassSchema,
    unresolvedAssumptions: z.array(z.string()),
    commandsRun: z.array(CommandRecordSchema),
    pendingExternalChecks: z.array(z.string()),
    // Metadata
    schemaVersion: z.number().int().positive(),
    taskId: z.string().uuid(),
    attemptNumber: z.number().int().positive(),
    baseSha: z.string().min(1),
    headSha: z.string().min(1),
    mergeBaseSha: z.string().min(1),
    createdAt: z.string().datetime(),
  })
  .strict();

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
