/**
 * Learn phase — records task metrics after merge.
 * Non-critical: if this fails, the task is still merged.
 */

import {
  type ActivityFunction,
  patched,
  proxyActivities,
} from "@temporalio/workflow";
import type {
  AuditActivities,
  TaskActivities,
  TaskMetricsData,
} from "../activity-types.js";

// ─── Legacy Input/Result (for replay compatibility) ───

export interface LearnInput {
  readonly taskId: string;
}

export interface LearnResult {
  readonly taskId: string;
  readonly lessonsLearned: number;
}

// ─── Extended Input/Result (M18) ───

export interface LearnFullInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly owner: string;
  readonly repo: string;
  readonly merged: boolean;
  readonly mergedSha?: string;
  readonly attemptNumber: number;
  readonly phaseIteration: number;
  readonly totalCostCents: number;
  readonly evidenceLocator?: {
    readonly taskId: string;
    readonly bundleId: string;
    readonly artifactPrefix: string;
  };
  readonly startedAt: string;
  readonly completedAt: string;
  readonly filesChanged?: number;
}

export interface LearnFullResult {
  readonly taskId: string;
  readonly lessonsLearned: number;
  readonly metrics: TaskMetricsData;
}

// ─── Phase ───

export async function learnPhase(
  input: LearnInput | LearnFullInput,
): Promise<LearnResult | LearnFullResult> {
  if (!patched("m18-real-learn")) {
    // Legacy stub for replay compatibility
    return { taskId: input.taskId, lessonsLearned: 0 };
  }

  const fullInput = input as LearnFullInput;

  const { checkKillSwitch } = proxyActivities<{
    checkKillSwitch: ActivityFunction<
      [string],
      { killed: boolean; scope: string }
    >;
  }>({
    startToCloseTimeout: "10s",
    retry: { maximumAttempts: 3 },
  });

  const { transitionTaskState } = proxyActivities<
    Pick<TaskActivities, "transitionTaskState">
  >({
    startToCloseTimeout: "30s",
    retry: { maximumAttempts: 3 },
  });

  const { insertAuditEntry } = proxyActivities<AuditActivities>({
    startToCloseTimeout: "30s",
    retry: { maximumAttempts: 3 },
  });

  // 1. Kill switch check (consistency)
  const killCheck = await checkKillSwitch(fullInput.taskId);
  if (killCheck.killed) {
    return { taskId: fullInput.taskId, lessonsLearned: 0 };
  }

  // 2. Compute metrics
  const startTime = new Date(fullInput.startedAt).getTime();
  const endTime = new Date(fullInput.completedAt).getTime();
  const durationMs = Math.max(0, endTime - startTime);

  const metrics: TaskMetricsData = {
    taskId: fullInput.taskId,
    merged: fullInput.merged,
    attemptCount: fullInput.attemptNumber,
    phaseIterations: fullInput.phaseIteration,
    totalCostCents: fullInput.totalCostCents,
    durationMs,
    timeToFirstEvidence: 0, // V1: not tracked granularly
    timeToMerge: 0, // V1: not tracked granularly
    filesChanged: fullInput.filesChanged ?? 0,
    linesAdded: 0, // V1: not available without git diff
    linesRemoved: 0,
  };

  // 3. Record metrics as audit entry
  try {
    await insertAuditEntry({
      actor: "system",
      actionType: "task_metrics_recorded",
      targetType: "task",
      targetId: fullInput.taskId,
      result: fullInput.merged ? "merged" : "completed",
      taskId: fullInput.taskId,
      content: metrics,
      contentHash: `learn-${fullInput.taskId}-${fullInput.attemptNumber}`,
    });
  } catch {
    // Learn phase is non-critical — don't fail the workflow
  }

  // 4. Transition to merged if applicable and not already
  if (fullInput.merged) {
    try {
      await transitionTaskState(fullInput.taskId, "merged", "system", {
        phase: "learn",
        mergedSha: fullInput.mergedSha,
        metrics,
      });
    } catch {
      // May already be in terminal state — non-critical
    }
  }

  return {
    taskId: fullInput.taskId,
    lessonsLearned: 1,
    metrics,
  };
}
