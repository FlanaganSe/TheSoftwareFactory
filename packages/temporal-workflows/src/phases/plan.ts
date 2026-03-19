/**
 * Plan phase — LLM planning.
 * Uses a frontier model to generate a structured implementation plan
 * from the repo map, relevant files, and task objective.
 */

import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type {
  AuditActivities,
  FileContentData,
  PlanActivities,
  RepoMapEntryData,
  SafetyActivities,
} from "../activity-types.js";

const safetyActivities = proxyActivities<SafetyActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const planActivities = proxyActivities<PlanActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 2 },
});

const auditActivities = proxyActivities<AuditActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3 },
});

export interface PlanInput {
  readonly taskId: string;
  readonly objective: string;
  readonly repoMap: readonly RepoMapEntryData[];
  readonly relevantFiles: readonly FileContentData[];
  readonly model: string;
}

export interface PlanResult {
  readonly taskId: string;
  readonly plan: string;
  readonly estimatedFiles: readonly string[];
  readonly estimatedComplexity: string;
}

export async function planPhase(input: PlanInput): Promise<PlanResult> {
  // Step 1: Check kill switch
  const killCheck = await safetyActivities.checkKillSwitch(input.taskId);
  if (killCheck.killed) {
    throw ApplicationFailure.nonRetryable(
      `Kill switch active: ${killCheck.scope}`,
    );
  }

  // Step 2: Check cost budget
  const costCheck = await safetyActivities.checkCostBudget(input.taskId, 50);
  if (!costCheck.allowed) {
    throw ApplicationFailure.nonRetryable(
      `Cost budget exceeded: ${costCheck.percentUsed.toFixed(0)}% used`,
    );
  }

  // Step 3: Call LLM to generate plan
  const result = await planActivities.generatePlan(
    input.objective,
    [...input.repoMap],
    [...input.relevantFiles],
    input.model,
  );

  // Step 4: Persist plan as audit entry
  const contentHash = simpleHash(`${input.taskId}:plan:${result.plan}`);
  await auditActivities.insertAuditEntry({
    actor: "system",
    actionType: "plan_generated",
    targetType: "task",
    targetId: input.taskId,
    result: "success",
    taskId: input.taskId,
    content: { plan: result.plan, estimatedFiles: result.estimatedFiles },
    contentHash,
  });

  // Estimate complexity from plan length and file count
  const complexity =
    result.estimatedFiles.length > 10
      ? "high"
      : result.estimatedFiles.length > 3
        ? "medium"
        : "low";

  return {
    taskId: input.taskId,
    plan: result.plan,
    estimatedFiles: result.estimatedFiles,
    estimatedComplexity: complexity,
  };
}

/** Simple deterministic hash for audit entries (workflow-safe, no crypto). */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `plan-${Math.abs(hash).toString(36)}`;
}
