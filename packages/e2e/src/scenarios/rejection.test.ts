/**
 * E2E: Rejection — Submit Task → Evidence → Reject → Failed
 */

import {
  getStateQuery,
  rejectSignal,
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
  env = await createE2EEnvironment({ taskQueue: "e2e-rejection" });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("E2E: Rejection Path", () => {
  it("task reaches failed state when rejected", async () => {
    const taskId = testTaskId("reject");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    // Wait for review phase and reject
    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      rejectSignal,
      { actor: "reviewer-1", reason: "not acceptable" },
    );

    await handle.result();

    // Verify final state is "failed"
    const finalState = await handle.query(getStateQuery);
    expect(finalState).toBe("failed");

    // Verify cleanup happened
    expect(env.mockState.branchesLeased.has(`factory/${taskId}`)).toBe(false);
  }, 60_000);
});
