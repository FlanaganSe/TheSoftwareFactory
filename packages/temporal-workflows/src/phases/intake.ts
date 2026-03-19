/**
 * Intake phase — first child workflow.
 * Validates task input, creates task in DB, transitions to assigned,
 * and captures a stub TrustedBaseContext (full implementation in M12).
 */

import type { TaskState } from "@software-factory/core";
import { proxyActivities } from "@temporalio/workflow";
import type { SafetyActivities, TaskActivities } from "../activity-types.js";

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

const safetyActivities = proxyActivities<SafetyActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

export interface IntakeInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly objective: string;
  readonly autonomyLevel: string;
  readonly createdBy: string;
  readonly needsClarification?: boolean;
}

export interface IntakeResult {
  readonly taskId: string;
  readonly state: TaskState;
  readonly baseSha: string;
  readonly needsClarification: boolean;
}

export async function intakePhase(input: IntakeInput): Promise<IntakeResult> {
  // Check kill switch before doing work
  const killCheck = await safetyActivities.checkKillSwitch(input.taskId);
  if (killCheck.killed) {
    throw new Error(`Kill switch active: ${killCheck.scope}`);
  }

  // Create task in DB (state: 'created')
  const task = await taskActivities.createTask({
    objective: input.objective,
    repoId: input.repoId,
    createdBy: input.createdBy,
    autonomyLevel: input.autonomyLevel,
  });

  // Stub TrustedBaseContext — full implementation in M12
  const baseSha = "stub-base-sha";

  // Check if clarification is needed (created → needs_clarification)
  const needsClarification = input.needsClarification === true;

  if (needsClarification) {
    await taskActivities.transitionTaskState(
      task.id,
      "needs_clarification",
      "system",
      {
        phase: "intake",
        action: "needs_clarification",
        reason: "ambiguous_objective",
      },
    );
    return {
      taskId: task.id,
      state: "needs_clarification",
      baseSha,
      needsClarification: true,
    };
  }

  // Transition directly to 'assigned' (created → assigned)
  const assigned = await taskActivities.transitionTaskState(
    task.id,
    "assigned",
    "system",
    { phase: "intake", action: "assign" },
  );

  return {
    taskId: task.id,
    state: assigned.state,
    baseSha,
    needsClarification: false,
  };
}
