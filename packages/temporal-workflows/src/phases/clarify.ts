/**
 * Clarification phase — blocks until human provides clarification.
 * No timeout — human must respond.
 */

import type { TaskState } from "@software-factory/core";
import { condition, proxyActivities, setHandler } from "@temporalio/workflow";
import type { TaskActivities } from "../activity-types.js";
import { clarifyResponseSignal } from "../signals.js";

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

export interface ClarifyInput {
  readonly taskId: string;
  readonly objective: string;
}

export interface ClarifyResult {
  readonly taskId: string;
  readonly state: TaskState;
  readonly updatedObjective: string;
}

export async function clarifyPhase(
  input: ClarifyInput,
): Promise<ClarifyResult> {
  let clarificationResponse: string | undefined;

  setHandler(clarifyResponseSignal, ({ response }) => {
    clarificationResponse = response;
  });

  // Block until clarification is received — no timeout
  await condition(() => clarificationResponse !== undefined);

  const updatedObjective = `${input.objective}\n\nClarification: ${clarificationResponse}`;

  // Transition from needs_clarification → assigned
  const updated = await taskActivities.transitionTaskState(
    input.taskId,
    "assigned",
    "system",
    {
      phase: "clarify",
      action: "clarification_received",
      clarification: clarificationResponse,
    },
  );

  return {
    taskId: input.taskId,
    state: updated.state,
    updatedObjective,
  };
}
