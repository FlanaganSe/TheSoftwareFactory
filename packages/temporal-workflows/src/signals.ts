/**
 * Versioned signal and query definitions.
 *
 * These form the contract between external code and workflows.
 * Once deployed with in-flight workflows, shapes cannot change without patching.
 */

import type { TaskState } from "@software-factory/core";
import { defineQuery, defineSignal } from "@temporalio/workflow";

// ─── Signals (external → workflow) ───

// Human-initiated signals
export const killSignal =
  defineSignal<[{ actor: string; reason?: string }]>("kill");
export const approveSignal =
  defineSignal<[{ actor: string; scope?: string }]>("approve");
export const rejectSignal =
  defineSignal<[{ actor: string; reason: string }]>("reject");
export const changesRequestedSignal =
  defineSignal<[{ actor: string; message: string }]>("changes_requested");
export const resumeSignal = defineSignal<[{ actor: string }]>("resume");
export const clarifyResponseSignal =
  defineSignal<[{ actor: string; response: string }]>("clarify_response");
export const costOverrideSignal =
  defineSignal<[{ actor: string; newBudgetCents: number }]>("cost_override");

// GitHub lifecycle signals (dispatched from webhook handler → workflow)
export const prReviewSignal =
  defineSignal<[{ action: string; state: string; reviewer: string }]>(
    "pr_review",
  );
export const checkCompleteSignal =
  defineSignal<[{ checkName: string; conclusion: string }]>("check_complete");
export const mergeQueueUpdateSignal =
  defineSignal<[{ status: string }]>("merge_queue_update");
export const prClosedSignal = defineSignal<[{ merged: boolean }]>("pr_closed");

// ─── Queries (external → workflow, synchronous read) ───

export const getStateQuery = defineQuery<TaskState>("getState");
export const getProgressQuery = defineQuery<WorkflowProgress>("getProgress");
export const getPhaseQuery = defineQuery<string>("getPhase");

// ─── Types ───

export interface WorkflowProgress {
  readonly taskId: string;
  readonly currentPhase: string;
  readonly state: TaskState;
  readonly attemptNumber: number;
  readonly phaseIteration: number;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly costCents: number;
  readonly costBudgetCents: number;
}
