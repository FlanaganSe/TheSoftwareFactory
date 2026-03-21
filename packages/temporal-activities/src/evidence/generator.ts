import type {
  CodeownersEntry,
  CommandRecord,
  DiffAnnotation,
  EvidenceBundle,
  PolicyConfig,
  ProtectedEdit,
} from "@software-factory/core";
import { EvidenceBundleSchema } from "@software-factory/core";
import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import { getOwners } from "../github/codeowners-parser.js";
import type { SandboxSupervisor } from "../sandbox/index.js";
import {
  type AnnotatedDiffResult,
  generateAnnotatedDiff,
} from "./diff-annotator.js";
import { redactSecrets } from "./redaction.js";

export interface EvidenceGeneratorConfig {
  readonly taskId: string;
  readonly objective: string;
  readonly attemptNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeBaseSha: string;
  readonly validationResult: ValidationData;
  readonly agentResult: AgentResultData;
  readonly capabilitySnapshot: CapabilityData;
  readonly codeownersEntries: readonly CodeownersEntry[];
  readonly changedFiles: readonly string[];
  readonly policies: readonly PolicyConfig[];
  readonly sandbox: SandboxSupervisor;
  readonly containerId: string;
}

/** Serializable validation data from M13 */
export interface ValidationData {
  readonly testResults: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly newTests?: readonly string[];
    readonly modifiedTests?: readonly string[];
    readonly deletedTests?: readonly string[];
    readonly details?: readonly {
      readonly name: string;
      readonly status: "passed" | "failed" | "skipped";
      readonly durationMs?: number;
      readonly errorMessage?: string;
    }[];
  };
  readonly lintResults: {
    readonly errorCount: number;
    readonly warningCount: number;
    readonly details?: readonly {
      readonly file: string;
      readonly line: number;
      readonly column: number;
      readonly rule: string;
      readonly severity: "error" | "warning";
      readonly message: string;
    }[];
  };
  readonly securityScanResults: {
    readonly vulnerabilities: readonly {
      readonly id: string;
      readonly severity: "critical" | "high" | "medium" | "low";
      readonly description: string;
      readonly file?: string;
      readonly line?: number;
    }[];
    readonly totalFindings: number;
    readonly criticalCount: number;
    readonly highCount: number;
  };
  readonly blastRadius: { readonly files: number; readonly packages: number };
  readonly protectedSurfaceEdits: readonly string[];
  readonly migrationImpact: {
    readonly hasMigrations: boolean;
    readonly migrationFiles: readonly string[];
    readonly schemaChanges: readonly string[];
  };
  readonly revertabilityClass:
    | "clean_revert"
    | "revert_with_migration"
    | "non_revertable";
  readonly commandsRun: readonly CommandRecord[];
  readonly sarifOutput?: string;
  readonly sbomOutput?: string;
  readonly testLog?: string;
  readonly validatorControlFileEdits?: readonly {
    readonly path: string;
    readonly category: string;
    readonly baseRefHash: string;
    readonly workspaceHash: string;
  }[];
}

/** Subset of AgentStepResult relevant to evidence */
export interface AgentResultData {
  readonly filesModified: readonly string[];
  readonly totalCostCents: number;
  readonly unresolvedAssumptions?: readonly string[];
  readonly commandsRun?: readonly CommandRecord[];
}

/** Subset of CapabilitySnapshot relevant to evidence */
export interface CapabilityData {
  readonly requiredStatusChecks: readonly { readonly context: string }[];
}

export interface GenerateEvidenceResult {
  readonly bundle: EvidenceBundle;
  readonly rawPatch: string;
  readonly annotations: readonly DiffAnnotation[];
}

/**
 * Generate a complete evidence bundle from validation and implementation results.
 * Maps each R-008 field from its source data.
 */
export async function generateEvidence(
  config: EvidenceGeneratorConfig,
): Promise<FactoryResult<GenerateEvidenceResult>> {
  // 1. Generate annotated diff
  const affectedConsumersMap = new Map<string, readonly string[]>();
  let diffResult: AnnotatedDiffResult;

  try {
    diffResult = await generateAnnotatedDiff(
      {
        containerId: config.containerId,
        sandbox: config.sandbox,
        baseSha: config.baseSha,
      },
      config.policies,
      affectedConsumersMap,
    );
  } catch (e) {
    return err(
      createFactoryError(
        "evidence_invariant_fail",
        `Failed to generate annotated diff: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
  }

  // 2. Compute owners impacted from CODEOWNERS
  const ownersSet = new Set<string>();
  for (const file of config.changedFiles) {
    const owners = getOwners(file, config.codeownersEntries);
    for (const owner of owners) {
      ownersSet.add(owner);
    }
  }

  // 3. Build protected surface edits
  const protectedEdits: ProtectedEdit[] = (
    config.validationResult.protectedSurfaceEdits ?? []
  ).map((filePath) => ({
    filePath,
    protectionClass: "flagged" as const,
    justification: "File matches protected surface policy",
  }));

  // 4. Merge commands from validation + agent
  const allCommands: CommandRecord[] = [
    ...(config.validationResult.commandsRun ?? []),
    ...(config.agentResult.commandsRun ?? []),
  ];

  // 5. Derive pending external checks
  const pendingExternalChecks =
    config.capabilitySnapshot.requiredStatusChecks.map(
      (check) => check.context,
    );

  // 6. Assemble the bundle
  const rawBundle = {
    // 13 R-008 fields
    objective: config.objective,
    annotatedDiff: diffResult.annotations as DiffAnnotation[],
    blastRadius: config.validationResult.blastRadius,
    ownersImpacted: [...ownersSet],
    testResults: {
      passed: config.validationResult.testResults.passed,
      failed: config.validationResult.testResults.failed,
      skipped: config.validationResult.testResults.skipped,
      newTests: [...(config.validationResult.testResults.newTests ?? [])],
      modifiedTests: [
        ...(config.validationResult.testResults.modifiedTests ?? []),
      ],
      deletedTests: [
        ...(config.validationResult.testResults.deletedTests ?? []),
      ],
      details: [...(config.validationResult.testResults.details ?? [])],
    },
    securityScanResults: {
      vulnerabilities: [
        ...config.validationResult.securityScanResults.vulnerabilities,
      ],
      totalFindings: config.validationResult.securityScanResults.totalFindings,
      criticalCount: config.validationResult.securityScanResults.criticalCount,
      highCount: config.validationResult.securityScanResults.highCount,
    },
    lintResults: {
      errorCount: config.validationResult.lintResults.errorCount,
      warningCount: config.validationResult.lintResults.warningCount,
      details: [...(config.validationResult.lintResults.details ?? [])],
    },
    protectedSurfaceEdits: protectedEdits,
    migrationImpact: {
      hasMigrations: config.validationResult.migrationImpact.hasMigrations,
      migrationFiles: [
        ...config.validationResult.migrationImpact.migrationFiles,
      ],
      schemaChanges: [...config.validationResult.migrationImpact.schemaChanges],
    },
    revertabilityClass: config.validationResult.revertabilityClass,
    unresolvedAssumptions: [
      ...(config.agentResult.unresolvedAssumptions ?? []),
    ],
    commandsRun: allCommands,
    pendingExternalChecks,
    // Metadata
    schemaVersion: 1,
    taskId: config.taskId,
    attemptNumber: config.attemptNumber,
    baseSha: config.baseSha,
    headSha: config.headSha,
    mergeBaseSha: config.mergeBaseSha,
    createdAt: new Date().toISOString(),
  };

  // 7. Redact secrets from the serialized bundle
  const serialized = JSON.stringify(rawBundle);
  const redacted = redactSecrets(serialized);
  const redactedBundle = JSON.parse(redacted) as typeof rawBundle;

  // 8. Validate against EvidenceBundleSchema
  const parseResult = EvidenceBundleSchema.safeParse(redactedBundle);
  if (!parseResult.success) {
    return err(
      createFactoryError(
        "evidence_invariant_fail",
        `Evidence bundle failed schema validation: ${parseResult.error.message}`,
      ),
    );
  }

  return ok({
    bundle: parseResult.data,
    rawPatch: redactSecrets(diffResult.rawPatch),
    annotations: diffResult.annotations as DiffAnnotation[],
  });
}
