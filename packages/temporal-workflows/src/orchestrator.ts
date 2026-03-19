/**
 * Parent orchestrator workflow.
 * Manages the entire task lifecycle by spawning child phase workflows
 * and handling signals/queries at the top level.
 */

import type { TaskState } from "@software-factory/core";
import {
  CancellationScope,
  allHandlersFinished,
  condition,
  continueAsNew,
  executeChild,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import { Mutex } from "async-mutex";

import {
  approveSignal,
  changesRequestedSignal,
  clarifyResponseSignal,
  costOverrideSignal,
  getPhaseQuery,
  getProgressQuery,
  getStateQuery,
  killSignal,
  rejectSignal,
  resumeSignal,
} from "./signals.js";
import type { WorkflowProgress } from "./signals.js";

// ─── Workflow Input / Config ───

export interface WorkflowConfig {
  readonly reviewTimeoutMs: number;
  readonly costBudgetCents: number;
  readonly maxImplementationAttempts: number;
}

export interface TaskWorkflowInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly objective: string;
  readonly autonomyLevel: "L0" | "L1" | "L2";
  readonly config: WorkflowConfig;
  readonly resumeFromPhase?: string;
  readonly attemptNumber?: number;
  readonly phaseIteration?: number;
}

// ─── Phase ordering ───

const PHASE_ORDER = [
  "intake",
  "understand",
  "plan",
  "setup",
  "implement",
  "validate",
  "evidence",
  "review",
  "pr_creation",
  "pr_tracking",
  "learn",
] as const;

type PhaseName = (typeof PHASE_ORDER)[number];

// ─── Orchestrator ───

export async function taskOrchestrator(
  input: TaskWorkflowInput,
): Promise<void> {
  const mutex = new Mutex();

  // ─── Mutable workflow state ───
  let killed = false;
  let killInfo: { actor: string; reason: string } | undefined;
  let currentPhase: PhaseName = "intake";
  let currentState: TaskState = "created";
  const attemptNumber = input.attemptNumber ?? 1;
  let phaseIteration = input.phaseIteration ?? 0;
  let costBudgetCents = input.config.costBudgetCents;
  const costCents = 0;
  const startedAt = new Date().toISOString();
  let lastActivityAt = startedAt;

  // ─── Signal Handlers ───

  setHandler(killSignal, async ({ actor, reason }) => {
    const release = await mutex.acquire();
    try {
      killed = true;
      killInfo = { actor, reason: reason ?? "" };
    } finally {
      release();
    }
  });

  // These handlers exist at the parent level to prevent "unhandled signal" warnings.
  // Actual signal processing for approve/reject/changes_requested/clarify happens
  // in child workflows (review, clarify) which register their own handlers.
  // The parent tracks lastActivityAt for progress reporting.

  setHandler(approveSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(rejectSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(changesRequestedSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(resumeSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  setHandler(clarifyResponseSignal, async () => {
    const release = await mutex.acquire();
    try {
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  // costOverrideSignal is handled at the parent level since it modifies
  // the workflow-wide budget, not a phase-specific concern.
  setHandler(costOverrideSignal, async ({ newBudgetCents }) => {
    const release = await mutex.acquire();
    try {
      costBudgetCents = newBudgetCents;
      lastActivityAt = new Date().toISOString();
    } finally {
      release();
    }
  });

  // ─── Query Handlers ───

  setHandler(getStateQuery, (): TaskState => currentState);

  setHandler(
    getProgressQuery,
    (): WorkflowProgress => ({
      taskId: input.taskId,
      currentPhase,
      state: currentState,
      attemptNumber,
      phaseIteration,
      startedAt,
      lastActivityAt,
      costCents,
      costBudgetCents,
    }),
  );

  setHandler(getPhaseQuery, (): string => currentPhase);

  // ─── Determine starting phase ───
  let startIdx = 0;
  if (input.resumeFromPhase) {
    const idx = PHASE_ORDER.indexOf(input.resumeFromPhase as PhaseName);
    if (idx >= 0) {
      startIdx = idx;
    }
  }

  // ─── Phase execution loop ───

  for (let i = startIdx; i < PHASE_ORDER.length; i++) {
    // Check kill flag between phases
    if (killed) {
      break;
    }

    // Check Continue-As-New triggers
    const info = workflowInfo();
    if (info.continueAsNewSuggested || info.historyLength > 10_000) {
      await condition(allHandlersFinished);
      await continueAsNew<typeof taskOrchestrator>({
        ...input,
        resumeFromPhase: PHASE_ORDER[i],
        attemptNumber,
        phaseIteration,
      });
    }

    const phase = PHASE_ORDER[i];
    currentPhase = phase;
    lastActivityAt = new Date().toISOString();

    // Phases that repeat on changes_requested need iteration in the ID
    // to avoid Temporal's workflow ID uniqueness constraint
    const needsIteration =
      phase === "implement" ||
      phase === "validate" ||
      phase === "evidence" ||
      phase === "review";
    const childId = needsIteration
      ? `task-${input.taskId}-${phase}-${phaseIteration}`
      : `task-${input.taskId}-${phase}`;

    if (phase === "intake") {
      const intakeResult = await executeChild("intakePhase", {
        workflowId: childId,
        args: [
          {
            taskId: input.taskId,
            repoId: input.repoId,
            objective: input.objective,
            autonomyLevel: input.autonomyLevel,
            createdBy: "system",
          },
        ],
      });

      currentState = intakeResult.state;

      // Handle clarification if needed
      if (intakeResult.needsClarification) {
        if (killed) break;

        const clarifyResult = await executeChild("clarifyPhase", {
          workflowId: `task-${input.taskId}-clarify`,
          args: [
            {
              taskId: intakeResult.taskId,
              objective: input.objective,
            },
          ],
        });
        currentState = clarifyResult.state;
      }
    } else if (phase === "understand") {
      currentState = "in_progress";
      await executeChild("understandPhase", {
        workflowId: childId,
        args: [
          {
            taskId: input.taskId,
            objective: input.objective,
            baseSha: "stub-base-sha",
          },
        ],
      });
    } else if (phase === "plan") {
      await executeChild("planPhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId, objective: input.objective }],
      });
    } else if (phase === "setup") {
      await executeChild("setupPhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId }],
      });
    } else if (phase === "implement") {
      await executeChild("implementPhase", {
        workflowId: childId,
        args: [
          {
            taskId: input.taskId,
            objective: input.objective,
            plan: "stub",
            iteration: phaseIteration,
          },
        ],
      });
    } else if (phase === "validate") {
      await executeChild("validatePhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId }],
      });
    } else if (phase === "evidence") {
      await executeChild("evidencePhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId }],
      });
    } else if (phase === "review") {
      const reviewResult = await executeChild("reviewPhase", {
        workflowId: childId,
        args: [
          {
            taskId: input.taskId,
            reviewTimeoutMs: input.config.reviewTimeoutMs,
          },
        ],
      });

      if (reviewResult.outcome === "approved") {
        currentState = "approved";
        // Continue to pr_creation
      } else if (reviewResult.outcome === "changes_requested") {
        // Loop back to implement
        phaseIteration++;
        if (phaseIteration < input.config.maxImplementationAttempts) {
          // Jump back to implement phase
          i = PHASE_ORDER.indexOf("implement") - 1; // -1 because loop increments
          currentState = "changes_requested";
          continue;
        }
        // Max attempts exceeded — fail
        currentState = "failed";
        break;
      } else if (reviewResult.outcome === "rejected") {
        currentState = "failed";
        break;
      } else if (reviewResult.outcome === "timed_out") {
        currentState = "failed";
        break;
      }
    } else if (phase === "pr_creation") {
      await executeChild("prCreationPhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId }],
      });
      currentState = "pr_created";
    } else if (phase === "pr_tracking") {
      await executeChild("prTrackingPhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId, prNumber: 0 }],
      });
      currentState = "merged";
    } else if (phase === "learn") {
      await executeChild("learnPhase", {
        workflowId: childId,
        args: [{ taskId: input.taskId }],
      });
    }
  }

  // ─── Cleanup on kill ───

  if (killed && killInfo) {
    await CancellationScope.nonCancellable(async () => {
      currentState = "cancelled";
      // killInfo is available for audit logging in future milestones
      void killInfo;
    });
  }

  // Drain all handlers before completing
  await condition(allHandlersFinished);
}
