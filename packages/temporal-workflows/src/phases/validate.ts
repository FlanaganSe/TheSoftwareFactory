/**
 * Validate phase — runs tests, linter, security scan, blast radius, and
 * validator boundary checks inside the existing sandbox.
 *
 * The trusted validator boundary prevents the agent from influencing its
 * own evaluation: test/lint commands come from TrustedBaseContext, Semgrep
 * config from the base ref, and control file edits are detected and reported.
 */

import type { PolicyConfig, TrustedBaseContext } from "@software-factory/core";
import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type {
  AuditActivities,
  BlastRadiusConfigData,
  LintRunnerConfigData,
  SafetyActivities,
  SecurityScanConfigData,
  TestRunnerConfigData,
  ValidationActivities,
  ValidatorBoundaryConfigData,
} from "../activity-types.js";

const safetyActivities = proxyActivities<SafetyActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const auditActivities = proxyActivities<AuditActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

const validationActivities = proxyActivities<ValidationActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 1 },
});

export interface ValidateInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly containerId: string;
  readonly trustedContext: TrustedBaseContext;
  readonly changedFiles: readonly string[];
  readonly indexVersionId: string;
  readonly policies: readonly PolicyConfig[];
}

export interface ValidateResult {
  readonly taskId: string;
  readonly passed: boolean;
  readonly validationResult: ValidationResultData;
}

/** Serializable subset of ValidationResult for workflow return. */
interface ValidationResultData {
  readonly testResults: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
  readonly testCommand: string;
  readonly testExitCode: number;
  readonly lintResults: {
    readonly errorCount: number;
    readonly warningCount: number;
  };
  readonly lintCommand: string;
  readonly lintExitCode: number;
  readonly securityFindings: number;
  readonly criticalVulnerabilities: number;
  readonly blastRadius: { readonly files: number; readonly packages: number };
  readonly filesChanged: readonly string[];
  readonly packagesAffected: readonly string[];
  readonly protectedSurfaceEdits: readonly string[];
  readonly hasMigrations: boolean;
  readonly revertabilityClass: string;
  readonly validatorControlFileEdits: readonly {
    readonly path: string;
    readonly category: string;
  }[];
  readonly trustedContextUsed: boolean;
  readonly passed: boolean;
  readonly summary: string;
}

export async function validatePhase(
  input: ValidateInput,
): Promise<ValidateResult> {
  // Step 1: Check kill switch
  const killCheck = await safetyActivities.checkKillSwitch(input.taskId);
  if (killCheck.killed) {
    throw ApplicationFailure.nonRetryable(
      `Kill switch active: ${killCheck.scope}`,
    );
  }

  // Step 2: Audit entry — validation started
  await auditActivities.insertAuditEntry({
    actor: "system",
    actionType: "validation_started",
    targetType: "task",
    targetId: input.taskId,
    result: "started",
    taskId: input.taskId,
    content: { phase: "validate" },
    contentHash: "",
  });

  // Step 3: Get changed files (authoritative from sandbox)
  const changedFiles =
    input.changedFiles.length > 0
      ? [...input.changedFiles]
      : await validationActivities.getChangedFiles(
          input.containerId,
          input.trustedContext.baseSha,
        );

  // Step 4: Determine test and lint commands from trusted context
  const testCommand =
    input.trustedContext.validationCommandSources.find((c) =>
      /\btest\b/i.test(c),
    ) ?? "npm test";
  const lintCommand =
    input.trustedContext.validationCommandSources.find((c) =>
      /\blint\b|\bbiome\b|\beslint\b/i.test(c),
    ) ?? "npx biome check .";

  // Step 5: Run test suite
  const testConfig: TestRunnerConfigData = {
    containerId: input.containerId,
    testCommand,
    workingDir: "/workspace",
    timeoutMs: 300_000,
  };
  const testRunResult = await validationActivities.runTests(testConfig);

  // Step 6: Run linter
  const lintConfig: LintRunnerConfigData = {
    containerId: input.containerId,
    lintCommand,
    workingDir: "/workspace",
    timeoutMs: 120_000,
  };
  const lintRunResult = await validationActivities.runLinter(lintConfig);

  // Step 7: Run security scanners
  const securityConfig: SecurityScanConfigData = {
    containerId: input.containerId,
    changedFiles,
    semgrepConfig: undefined,
    workingDir: "/workspace",
    timeoutMs: 300_000,
  };
  const securityResult =
    await validationActivities.runSecurityScan(securityConfig);

  // Step 8: Compute blast radius
  const blastRadiusConfig: BlastRadiusConfigData = {
    indexVersionId: input.indexVersionId,
    changedFiles,
    policies: input.policies,
  };
  const blastRadiusResult =
    await validationActivities.computeBlastRadius(blastRadiusConfig);

  // Step 9: Check validator boundary integrity
  const boundaryConfig: ValidatorBoundaryConfigData = {
    containerId: input.containerId,
    trustedContext: input.trustedContext,
  };
  const controlFileEdits =
    await validationActivities.checkValidatorBoundary(boundaryConfig);

  // Step 10: Determine overall pass/fail
  const testsPassed = testRunResult.exitCode === 0;
  const lintPassed = lintRunResult.exitCode === 0;
  const noCriticalVulns =
    securityResult.securityScanResults.criticalCount === 0;
  const passed = testsPassed && lintPassed && noCriticalVulns;

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(
    `Tests: ${testRunResult.testResults.passed} passed, ${testRunResult.testResults.failed} failed`,
  );
  summaryParts.push(
    `Lint: ${lintRunResult.lintResults.errorCount} errors, ${lintRunResult.lintResults.warningCount} warnings`,
  );
  summaryParts.push(
    `Security: ${securityResult.securityScanResults.totalFindings} findings (${securityResult.securityScanResults.criticalCount} critical)`,
  );
  summaryParts.push(
    `Blast radius: ${blastRadiusResult.blastRadius.files} files, ${blastRadiusResult.blastRadius.packages} packages`,
  );
  if (controlFileEdits.length > 0) {
    summaryParts.push(
      `⚠ ${controlFileEdits.length} validator control file(s) modified`,
    );
  }

  const validationResult: ValidationResultData = {
    testResults: {
      passed: testRunResult.testResults.passed,
      failed: testRunResult.testResults.failed,
      skipped: testRunResult.testResults.skipped,
    },
    testCommand,
    testExitCode: testRunResult.exitCode,
    lintResults: {
      errorCount: lintRunResult.lintResults.errorCount,
      warningCount: lintRunResult.lintResults.warningCount,
    },
    lintCommand,
    lintExitCode: lintRunResult.exitCode,
    securityFindings: securityResult.securityScanResults.totalFindings,
    criticalVulnerabilities: securityResult.securityScanResults.criticalCount,
    blastRadius: blastRadiusResult.blastRadius,
    filesChanged: blastRadiusResult.filesChanged,
    packagesAffected: blastRadiusResult.packagesAffected,
    protectedSurfaceEdits: blastRadiusResult.protectedSurfaceEdits,
    hasMigrations: blastRadiusResult.migrationImpact.hasMigrations,
    revertabilityClass: blastRadiusResult.revertabilityClass,
    validatorControlFileEdits: controlFileEdits.map((e) => ({
      path: e.path,
      category: e.category,
    })),
    trustedContextUsed: true,
    passed,
    summary: summaryParts.join(". "),
  };

  // Step 11: Audit entry — validation completed
  await auditActivities.insertAuditEntry({
    actor: "system",
    actionType: "validation_completed",
    targetType: "task",
    targetId: input.taskId,
    result: passed ? "passed" : "failed",
    taskId: input.taskId,
    content: { passed, summary: validationResult.summary },
    contentHash: "",
  });

  return {
    taskId: input.taskId,
    passed,
    validationResult,
  };
}
