import type {
  DiffAnnotation,
  ValidatorControlFileEdit,
} from "@software-factory/core";

export interface RiskCategorization {
  readonly hardBlockers: readonly string[];
  readonly softConcerns: readonly string[];
  readonly humanJudgmentRequired: readonly string[];
  readonly informational: readonly string[];
}

interface ValidationSummary {
  readonly testsPassed: boolean;
  readonly testFailCount: number;
  readonly criticalVulnCount: number;
  readonly highVulnCount: number;
  readonly mediumVulnCount: number;
  readonly lintErrorCount: number;
  readonly lintWarningCount: number;
  readonly hasMigrations: boolean;
  readonly protectedSurfaceEdits: readonly string[];
}

/**
 * Categorize risks from validation results and diff annotations.
 * Deterministic — no LLM involved.
 */
export function categorizeRisks(
  validation: ValidationSummary,
  annotations: readonly DiffAnnotation[],
  validatorControlFileEdits: readonly ValidatorControlFileEdit[],
): RiskCategorization {
  const hardBlockers: string[] = [];
  const softConcerns: string[] = [];
  const humanJudgmentRequired: string[] = [];
  const informational: string[] = [];

  // Hard blockers: test failures
  if (!validation.testsPassed && validation.testFailCount > 0) {
    hardBlockers.push(
      `${validation.testFailCount} test(s) failed — must fix before merge`,
    );
  }

  // Hard blockers: critical security vulnerabilities
  if (validation.criticalVulnCount > 0) {
    hardBlockers.push(
      `${validation.criticalVulnCount} critical security vulnerability(ies) found`,
    );
  }

  // Soft concerns: high-risk annotations
  const highRiskAnnotations = annotations.filter((a) => a.riskLevel === "high");
  if (highRiskAnnotations.length > 0) {
    softConcerns.push(
      `${highRiskAnnotations.length} high-risk diff hunk(s) detected`,
    );
  }

  // Soft concerns: protected surface edits
  if (validation.protectedSurfaceEdits.length > 0) {
    softConcerns.push(
      `${validation.protectedSurfaceEdits.length} protected surface edit(s)`,
    );
  }

  // Soft concerns: high vulnerabilities
  if (validation.highVulnCount > 0) {
    softConcerns.push(
      `${validation.highVulnCount} high-severity vulnerability(ies)`,
    );
  }

  // Soft concerns: lint errors above threshold
  if (validation.lintErrorCount > 0) {
    softConcerns.push(`${validation.lintErrorCount} lint error(s)`);
  }

  // Human judgment required: migration impact
  if (validation.hasMigrations) {
    humanJudgmentRequired.push(
      "Migration impact detected — review schema changes carefully",
    );
  }

  // Human judgment required: validator control file edits
  if (validatorControlFileEdits.length > 0) {
    humanJudgmentRequired.push(
      `${validatorControlFileEdits.length} validator control file(s) modified by agent — verify intent`,
    );
  }

  // Human judgment required: medium security findings
  if (validation.mediumVulnCount > 0) {
    humanJudgmentRequired.push(
      `${validation.mediumVulnCount} medium-severity security finding(s) — assess applicability`,
    );
  }

  // Informational: lint warnings
  if (validation.lintWarningCount > 0) {
    informational.push(`${validation.lintWarningCount} lint warning(s)`);
  }

  // Informational: low-risk annotations
  const lowRiskCount = annotations.filter((a) => a.riskLevel === "low").length;
  if (lowRiskCount > 0) {
    informational.push(`${lowRiskCount} low-risk change(s)`);
  }

  return { hardBlockers, softConcerns, humanJudgmentRequired, informational };
}
