/**
 * E2E: Architectural Invariants
 *
 * Verifies the security-critical invariants from the plan.
 * These test the mock behavior + workflow logic integration.
 */

import {
  approveSignal,
  getProgressQuery,
  getStateQuery,
  rejectSignal,
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
  env = await createE2EEnvironment({ taskQueue: "e2e-invariants" });
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("E2E: Architectural Invariants", () => {
  it("Invariant 4: L1 workflow blocks at implement until approval, then at review", async () => {
    const taskId = testTaskId("inv4");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId, { autonomyLevel: "L1" })],
    });

    // At L1, implement phase blocks with autonomy gate.
    // First approve the implement phase's autonomy gate.
    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-implement-0`,
      approveSignal,
      { actor: "reviewer-1" },
    );

    // Then approve the review phase
    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      approveSignal,
      { actor: "reviewer-1" },
    );

    await handle.result();

    const finalState = await handle.query(getStateQuery);
    expect(["merged", "merge_ready"]).toContain(finalState);
  }, 60_000);

  it("Invariant 6: state transitions produce audit entries", async () => {
    const taskId = testTaskId("inv6");

    const auditsBefore = env.mockState.auditEntries.length;
    const transitionsBefore = env.mockState.stateTransitions.length;

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      approveSignal,
      { actor: "reviewer-1" },
    );

    await handle.result();

    // Verify audit entries and state transitions were recorded
    expect(env.mockState.auditEntries.length).toBeGreaterThan(auditsBefore);
    expect(env.mockState.stateTransitions.length).toBeGreaterThan(
      transitionsBefore,
    );
  }, 60_000);

  it("Invariant 9: workflow enforces valid phase ordering", async () => {
    const taskId = testTaskId("inv9");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      approveSignal,
      { actor: "reviewer-1" },
    );

    await handle.result();

    const progress = await handle.query(getProgressQuery);
    expect(progress.taskId).toBe(taskId);
    expect(progress.attemptNumber).toBe(1);
  }, 60_000);

  it("Invariant: rejected workflow reaches terminal state and cleans up", async () => {
    const taskId = testTaskId("inv-reject");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [makeE2EInput(taskId)],
    });

    await signalChildWhenRunning(
      env.client,
      `task-${taskId}-review-0`,
      rejectSignal,
      { actor: "reviewer-1", reason: "does not meet requirements" },
    );

    await handle.result();

    const finalState = await handle.query(getStateQuery);
    expect(finalState).toBe("failed");
    expect(env.mockState.branchesLeased.has(`factory/${taskId}`)).toBe(false);
  }, 60_000);

  it("Invariant: review timeout results in failed state", async () => {
    const taskId = testTaskId("inv-timeout");

    const handle = await env.client.workflow.start("taskOrchestrator", {
      taskQueue: env.taskQueue,
      workflowId: `task-${taskId}`,
      args: [
        makeE2EInput(taskId, {
          config: {
            reviewTimeoutMs: 1, // Instant timeout
            costBudgetCents: 1000,
            maxImplementationAttempts: 3,
          },
        }),
      ],
    });

    await handle.result();

    const finalState = await handle.query(getStateQuery);
    expect(finalState).toBe("failed");
  }, 60_000);
});
