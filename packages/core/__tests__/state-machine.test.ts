import { describe, expect, it } from "vitest";
import type { TaskState } from "../src/schemas/task.js";
import { TASK_STATES } from "../src/schemas/task.js";
import {
  TASK_TRANSITIONS,
  canTransition,
  getValidTransitions,
  isTerminal,
} from "../src/state-machine.js";

const TERMINAL_STATES: TaskState[] = ["merged", "failed", "cancelled"];

const NON_TERMINAL_STATES = TASK_STATES.filter(
  (s) => !TERMINAL_STATES.includes(s),
);

describe("canTransition", () => {
  // All 21 explicit transitions
  const validTransitions: [TaskState, TaskState][] = [
    ["created", "needs_clarification"],
    ["created", "assigned"],
    ["needs_clarification", "assigned"],
    ["assigned", "in_progress"],
    ["in_progress", "evidence_ready"],
    ["in_progress", "failed"],
    ["in_progress", "paused"],
    ["paused", "in_progress"],
    ["paused", "cancelled"],
    ["evidence_ready", "changes_requested"],
    ["evidence_ready", "approved"],
    ["changes_requested", "in_progress"],
    ["approved", "pr_created"],
    ["pr_created", "external_checks_pending"],
    ["external_checks_pending", "addressing_review_feedback"],
    ["external_checks_pending", "external_blocked"],
    ["external_checks_pending", "merge_ready"],
    ["addressing_review_feedback", "external_checks_pending"],
    ["external_blocked", "external_checks_pending"],
    ["merge_ready", "merged"],
    ["merge_ready", "failed"],
  ];

  it.each(validTransitions)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // Invalid transitions
  const invalidTransitions: [TaskState, TaskState][] = [
    ["created", "in_progress"],
    ["created", "merged"],
    ["assigned", "evidence_ready"],
    ["in_progress", "approved"],
    ["evidence_ready", "merged"],
    ["approved", "merged"],
    ["pr_created", "merged"],
    ["merge_ready", "in_progress"],
    ["merged", "created"],
    ["failed", "in_progress"],
    ["cancelled", "created"],
    ["merged", "cancelled"],
    ["failed", "cancelled"],
  ];

  it.each(invalidTransitions)("rejects %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("terminal states", () => {
  it.each(TERMINAL_STATES)("%s has zero outgoing transitions", (state) => {
    const transitions = getValidTransitions(state);
    expect(transitions).toHaveLength(0);
  });

  it.each(TERMINAL_STATES)("isTerminal returns true for %s", (state) => {
    expect(isTerminal(state)).toBe(true);
  });

  it.each(NON_TERMINAL_STATES)("isTerminal returns false for %s", (state) => {
    expect(isTerminal(state)).toBe(false);
  });
});

describe("cancelled reachability", () => {
  it.each(NON_TERMINAL_STATES)("%s can transition to cancelled", (state) => {
    expect(canTransition(state, "cancelled")).toBe(true);
  });
});

describe("paused transitions", () => {
  it("paused → in_progress (resume)", () => {
    expect(canTransition("paused", "in_progress")).toBe(true);
  });

  it("paused → cancelled", () => {
    expect(canTransition("paused", "cancelled")).toBe(true);
  });
});

describe("getValidTransitions", () => {
  it("returns correct set for created", () => {
    const valid = getValidTransitions("created");
    expect(valid).toContain("needs_clarification");
    expect(valid).toContain("assigned");
    expect(valid).toContain("cancelled");
    expect(valid).toHaveLength(3);
  });

  it("returns correct set for in_progress", () => {
    const valid = getValidTransitions("in_progress");
    expect(valid).toContain("evidence_ready");
    expect(valid).toContain("failed");
    expect(valid).toContain("paused");
    expect(valid).toContain("cancelled");
    expect(valid).toHaveLength(4);
  });

  it("returns correct set for external_checks_pending", () => {
    const valid = getValidTransitions("external_checks_pending");
    expect(valid).toContain("addressing_review_feedback");
    expect(valid).toContain("external_blocked");
    expect(valid).toContain("merge_ready");
    expect(valid).toContain("cancelled");
    expect(valid).toHaveLength(4);
  });

  it("returns empty array for merged", () => {
    expect(getValidTransitions("merged")).toHaveLength(0);
  });
});

describe("TASK_TRANSITIONS map", () => {
  it("has an entry for every state", () => {
    for (const state of TASK_STATES) {
      expect(TASK_TRANSITIONS.has(state)).toBe(true);
    }
  });
});
