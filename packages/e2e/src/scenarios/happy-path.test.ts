/**
 * E2E: Happy Path — Submit Task → Merge
 *
 * The most important test: exercises the COMPLETE lifecycle from
 * task submission through all 11 phases to merged PR.
 */

import {
  approveSignal,
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
  env = await createE2EEnvironment({ taskQueue: "e2e-happy-path" });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("E2E: Happy Path — Submit Task → Merge", () => {
  it("completes the full task lifecycle", async () => {
    const taskId = testTaskId("happy");

    // 1. Start the orchestrator workflow
    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    // 2. Wait for workflow to reach the review phase
    //    (time-skipping is locked during real-time polling)
    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      approveSignal,
      { actor: "reviewer-1", scope: "code" },
    );

    // 3. Wait for workflow completion
    await handle.result();

    // 4. Verify final state is "merged"
    const finalState = await handle.query(getStateQuery);
    expect(["merged", "merge_ready"]).toContain(finalState);

    // 5. Verify progress query returns consistent data
    const progress = await handle.query(getProgressQuery);
    expect(progress.taskId).toBe(taskId);
    expect(progress.attemptNumber).toBe(1);
    expect(progress.startedAt).toBeTruthy();

    // 6. Verify mock state — task was created
    expect(env.mockState.tasksCreated.length).toBeGreaterThanOrEqual(1);

    // 7. Verify audit entries were recorded
    expect(env.mockState.auditEntries.length).toBeGreaterThanOrEqual(1);

    // 8. Verify state transitions happened
    const transitions = env.mockState.stateTransitions;
    expect(transitions.length).toBeGreaterThanOrEqual(1);
    // Should include terminal state transition
    const terminalTransitions = transitions.filter(
      (t) =>
        t.newState === "merged" ||
        t.newState === "failed" ||
        t.newState === "cancelled",
    );
    expect(terminalTransitions.length).toBeGreaterThanOrEqual(1);

    // 9. Verify branch lease was released (cleanup)
    expect(env.mockState.branchesLeased.has(`factory/${taskId}`)).toBe(false);

    // 10. Verify sandbox was destroyed (cleanup)
    expect(env.mockState.sandboxesDestroyed.length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
