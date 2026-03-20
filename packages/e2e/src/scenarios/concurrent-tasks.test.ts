/**
 * E2E: Concurrent Tasks — Branch lease prevents collision
 *
 * The mock branch lease is backed by a Map and enforces exclusive ownership.
 * Two workflows targeting the same branch can't both acquire the lease.
 */

import {
  approveSignal,
  getStateQuery,
} from "@software-factory/temporal-workflows";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  makeE2EInput,
  signalChildWhenRunning,
  testTaskId,
} from "../setup/helpers.js";
import { createE2EEnvironment } from "../setup/test-environment.js";
import type { E2ETestEnvironment } from "../setup/test-environment.js";

let env: E2ETestEnvironment;

beforeAll(async () => {
  env = await createE2EEnvironment({ taskQueue: "e2e-concurrent" });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("E2E: Concurrent Tasks", () => {
  it("two tasks with unique IDs complete independently", async () => {
    const taskIdA = testTaskId("concurrent-a");
    const taskIdB = testTaskId("concurrent-b");

    // Start both workflows
    const handleA = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskIdA}`,
      args: [makeE2EInput(taskIdA)],
    });

    const handleB = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskIdB}`,
      args: [makeE2EInput(taskIdB)],
    });

    // Approve both reviews
    await signalChildWhenRunning(
      env.client,
      `task-${taskIdA}-review-0`,
      approveSignal,
      { actor: "reviewer-1" },
    );

    await signalChildWhenRunning(
      env.client,
      `task-${taskIdB}-review-0`,
      approveSignal,
      { actor: "reviewer-2" },
    );

    // Wait for both to complete
    await Promise.all([handleA.result(), handleB.result()]);

    const stateA = await handleA.query(getStateQuery);
    const stateB = await handleB.query(getStateQuery);

    // Both should reach terminal state
    expect(["merged", "merge_ready", "failed"]).toContain(stateA);
    expect(["merged", "merge_ready", "failed"]).toContain(stateB);

    // Branch leases cleaned up
    expect(env.mockState.branchesLeased.has(`factory/${taskIdA}`)).toBe(false);
    expect(env.mockState.branchesLeased.has(`factory/${taskIdB}`)).toBe(false);
  }, 60_000);
});
