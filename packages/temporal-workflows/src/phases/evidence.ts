/**
 * Evidence phase — assembles evidence packet from validation results,
 * uploads artifacts to MinIO, persists bundle to Postgres, and returns
 * an EvidenceLocator for downstream consumption.
 */

import type { CodeownersEntry, PolicyConfig } from "@software-factory/core";
import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type {
  AuditActivities,
  EvidenceActivities,
  EvidenceAgentResultData,
  EvidenceCapabilityData,
  EvidenceLocatorData,
  EvidenceValidationData,
  RiskCategorizationData,
  SafetyActivities,
  TaskActivities,
} from "../activity-types.js";

const safetyActivities = proxyActivities<SafetyActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const auditActivities = proxyActivities<AuditActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

const evidenceActivities = proxyActivities<EvidenceActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 1 },
});

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

export interface EvidenceInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly objective: string;
  readonly attemptNumber: number;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeBaseSha: string;
  readonly containerId: string;
  readonly validationResult: EvidenceValidationData;
  readonly agentResult: EvidenceAgentResultData;
  readonly capabilitySnapshot: EvidenceCapabilityData;
  readonly changedFiles: readonly string[];
  readonly policies: readonly PolicyConfig[];
  readonly codeownersEntries: readonly CodeownersEntry[];
  readonly indexVersionId: string;
}

export interface EvidenceResult {
  readonly taskId: string;
  readonly bundleId: string;
  readonly locator: EvidenceLocatorData;
  readonly riskSummary: RiskCategorizationData;
  readonly passed: boolean;
}

export async function evidencePhase(
  input: EvidenceInput,
): Promise<EvidenceResult> {
  // Step 1: Check kill switch
  const killCheck = await safetyActivities.checkKillSwitch(input.taskId);
  if (killCheck.killed) {
    throw ApplicationFailure.nonRetryable(
      `Kill switch active: ${killCheck.scope}`,
    );
  }

  // Step 2: Audit entry — evidence generation started
  await auditActivities.insertAuditEntry({
    actor: "system",
    actionType: "evidence_generated",
    targetType: "task",
    targetId: input.taskId,
    result: "started",
    taskId: input.taskId,
    content: { phase: "evidence", action: "started" },
    contentHash: "",
  });

  // Step 3: Generate evidence, upload artifacts, persist, seal
  const result = await evidenceActivities.generateAndPersistEvidence({
    taskId: input.taskId,
    objective: input.objective,
    attemptNumber: input.attemptNumber,
    baseSha: input.baseSha,
    headSha: input.headSha,
    mergeBaseSha: input.mergeBaseSha,
    containerId: input.containerId,
    validationResult: input.validationResult,
    agentResult: input.agentResult,
    capabilitySnapshot: input.capabilitySnapshot,
    codeownersEntries: input.codeownersEntries,
    changedFiles: [...input.changedFiles],
    policies: [...input.policies],
  });

  // Step 4: Transition task state to evidence_ready
  await taskActivities.transitionTaskState(
    input.taskId,
    "evidence_ready",
    "system",
    {
      phase: "evidence",
      bundleId: result.bundleId,
      passed: result.passed,
      hardBlockers: result.riskSummary.hardBlockers.length,
    },
  );

  // Step 5: Audit entry — evidence generation completed
  await auditActivities.insertAuditEntry({
    actor: "system",
    actionType: "evidence_generated",
    targetType: "evidence",
    targetId: result.bundleId,
    result: result.passed ? "passed" : "concerns_found",
    taskId: input.taskId,
    content: {
      phase: "evidence",
      action: "completed",
      bundleId: result.bundleId,
      passed: result.passed,
      riskSummary: result.riskSummary,
    },
    contentHash: "",
  });

  return {
    taskId: input.taskId,
    bundleId: result.bundleId,
    locator: result.locator,
    riskSummary: result.riskSummary,
    passed: result.passed,
  };
}
