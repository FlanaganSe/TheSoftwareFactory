/**
 * Review phase — handles approve/reject/changes_requested signals.
 * Configurable timeout (default 4 hours) with escalation on timeout.
 */

import { condition, proxyActivities, setHandler } from "@temporalio/workflow";
import type { AuditActivities, TaskActivities } from "../activity-types.js";
import {
  approveSignal,
  changesRequestedSignal,
  rejectSignal,
} from "../signals.js";

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

const auditActivities = proxyActivities<AuditActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

export interface ReviewInput {
  readonly taskId: string;
  readonly reviewTimeoutMs: number;
}

export type ReviewOutcome =
  | "approved"
  | "rejected"
  | "changes_requested"
  | "timed_out";

export interface ReviewResult {
  readonly taskId: string;
  readonly outcome: ReviewOutcome;
  readonly actor?: string;
  readonly message?: string;
}

export async function reviewPhase(input: ReviewInput): Promise<ReviewResult> {
  let result: ReviewResult | undefined;

  setHandler(approveSignal, ({ actor }) => {
    if (!result) {
      result = { taskId: input.taskId, outcome: "approved", actor };
    }
  });

  setHandler(rejectSignal, ({ actor, reason }) => {
    if (!result) {
      result = {
        taskId: input.taskId,
        outcome: "rejected",
        actor,
        message: reason,
      };
    }
  });

  setHandler(changesRequestedSignal, ({ actor, message }) => {
    if (!result) {
      result = {
        taskId: input.taskId,
        outcome: "changes_requested",
        actor,
        message,
      };
    }
  });

  // Wait for signal or timeout
  const signalReceived = await condition(
    () => result !== undefined,
    input.reviewTimeoutMs,
  );

  if (!signalReceived) {
    // Timeout — fire escalation audit entry and fail
    await auditActivities.insertAuditEntry({
      actor: "system",
      actionType: "review_timeout",
      targetType: "task",
      targetId: input.taskId,
      result: "timeout",
      taskId: input.taskId,
      content: {
        phase: "review",
        timeoutMs: input.reviewTimeoutMs,
        action: "escalation_triggered",
      },
      contentHash: "review-timeout",
    });

    await taskActivities.transitionTaskState(input.taskId, "failed", "system", {
      phase: "review",
      action: "timeout",
      timeoutMs: input.reviewTimeoutMs,
    });

    return { taskId: input.taskId, outcome: "timed_out" };
  }

  // result is guaranteed defined here — condition() returned true
  return result as ReviewResult;
}
