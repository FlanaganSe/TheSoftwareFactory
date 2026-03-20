/**
 * E2E: Kill Switch — Per-task kill, global kill, kill during review
 */

import {
  approveSignal,
  getStateQuery,
  killSignal,
} from "@software-factory/temporal-workflows";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  makeE2EInput,
  signalChildWhenRunning,
  testTaskId,
  waitForQuery,
} from "../setup/helpers.js";
import { createE2EEnvironment } from "../setup/test-environment.js";
import type { E2ETestEnvironment } from "../setup/test-environment.js";

let env: E2ETestEnvironment;

beforeAll(async () => {
  env = await createE2EEnvironment({ taskQueue: "e2e-kill-switch" });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("E2E: Kill Switch", () => {
  it("kill signal during review phase cancels cleanly", async () => {
    const taskId = testTaskId("kill-review");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    // Wait for review phase — but instead of approving, first approve
    // then immediately kill to test kill during late phases
    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      approveSignal,
      { actor: "reviewer-1" },
    );

    // Send kill to parent — it checks the killed flag between phases
    await handle.signal(killSignal, {
      actor: "operator",
      reason: "emergency stop",
    });

    await handle.result();

    const finalState = await handle.query(getStateQuery);
    expect(finalState).toBe("cancelled");

    // Verify cleanup happened
    expect(env.mockState.branchesLeased.has(`factory/${taskId}`)).toBe(false);
  }, 60_000);

  it("kill signal stops workflow before review", async () => {
    const taskId = testTaskId("kill-early");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    // Wait for the workflow to start processing, then kill
    await waitForQuery(
      handle,
      { name: "getPhase" },
      (phase: string) => phase !== "intake",
      10_000,
    );

    await handle.signal(killSignal, {
      actor: "operator",
      reason: "kill before review",
    });

    await handle.result();

    const finalState = await handle.query(getStateQuery);
    expect(finalState).toBe("cancelled");
  }, 60_000);
});
