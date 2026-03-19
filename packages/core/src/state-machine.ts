import type { TaskState } from "./schemas/task.js";

const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  "merged",
  "failed",
  "cancelled",
]);

const NON_TERMINAL_STATES: readonly TaskState[] = [
  "created",
  "needs_clarification",
  "assigned",
  "in_progress",
  "paused",
  "evidence_ready",
  "changes_requested",
  "approved",
  "pr_created",
  "external_checks_pending",
  "addressing_review_feedback",
  "external_blocked",
  "merge_ready",
];

/**
 * Build the transition map from the 22 rules:
 * - 21 explicit transitions
 * - 1 wildcard: any non-terminal state → cancelled
 */
function buildTransitions(): ReadonlyMap<TaskState, ReadonlySet<TaskState>> {
  const map = new Map<TaskState, Set<TaskState>>();

  const add = (from: TaskState, to: TaskState): void => {
    let set = map.get(from);
    if (!set) {
      set = new Set();
      map.set(from, set);
    }
    set.add(to);
  };

  // 21 explicit transitions
  add("created", "needs_clarification");
  add("created", "assigned");
  add("needs_clarification", "assigned");
  add("assigned", "in_progress");
  add("in_progress", "evidence_ready");
  add("in_progress", "failed");
  add("in_progress", "paused");
  add("paused", "in_progress");
  add("paused", "cancelled");
  add("evidence_ready", "changes_requested");
  add("evidence_ready", "approved");
  add("changes_requested", "in_progress");
  add("approved", "pr_created");
  add("pr_created", "external_checks_pending");
  add("external_checks_pending", "addressing_review_feedback");
  add("external_checks_pending", "external_blocked");
  add("external_checks_pending", "merge_ready");
  add("addressing_review_feedback", "external_checks_pending");
  add("external_blocked", "external_checks_pending");
  add("merge_ready", "merged");
  add("merge_ready", "failed");

  // Wildcard: any non-terminal state → cancelled
  for (const state of NON_TERMINAL_STATES) {
    add(state, "cancelled");
  }

  // Ensure terminal states have empty sets
  for (const state of TERMINAL_STATES) {
    if (!map.has(state)) {
      map.set(state, new Set());
    }
  }

  return map;
}

export const TASK_TRANSITIONS: ReadonlyMap<
  TaskState,
  ReadonlySet<TaskState>
> = buildTransitions();

export function canTransition(from: TaskState, to: TaskState): boolean {
  const targets = TASK_TRANSITIONS.get(from);
  return targets?.has(to) ?? false;
}

export function getValidTransitions(from: TaskState): readonly TaskState[] {
  const targets = TASK_TRANSITIONS.get(from);
  return targets ? [...targets] : [];
}

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_STATES.has(state);
}
