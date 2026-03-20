/**
 * E2E: Feedback Loop — Submit → Evidence → Changes Requested → Re-implement → Approve → Merge
 */

import {
  approveSignal,
  changesRequestedSignal,
  getProgressQuery,
  getStateQuery,
} from "@software-factory/temporal-workflows";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  makeE2EInput,
  signalChildWhenRunning,
  testTaskId,
} from "../setup/helpers.js";
import type { E2ETestEnvironment } from "../setup/test-environment.js";
import { createE2EEnvironment } from "../setup/test-environment.js";

let env: E2ETestEnvironment;

beforeAll(async () => {
  env = await createE2EEnvironment({ taskQueue: "e2e-feedback" });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("E2E: Feedback Loop", () => {
  it("re-implements when changes are requested, then completes on approval", async () => {
    const taskId = testTaskId("feedback");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    // First review: request changes
    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      changesRequestedSignal,
      { actor: "reviewer-1", message: "fix the tests" },
    );

    // After changes_requested, orchestrator loops back to implement.
    // phaseIteration increments to 1 → second review child is review-1.
    await new Promise((r) => setTimeout(r, 1000));

    // Verify iteration incremented
    const progress = await handle.query(getProgressQuery);
    expect(progress.phaseIteration).toBeGreaterThanOrEqual(1);

    // Second review: approve
    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-1`,
      approveSignal,
      { actor: "reviewer-1" },
    );

    await handle.result();

    const finalState = await handle.query(getStateQuery);
    expect(["merged", "merge_ready"]).toContain(finalState);

    // Verify cleanup
    expect(env.mockState.branchesLeased.has(`factory/${taskId}`)).toBe(false);
  }, 60_000);
});
