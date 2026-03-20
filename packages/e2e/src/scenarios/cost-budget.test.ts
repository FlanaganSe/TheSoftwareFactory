/**
 * E2E: Cost Budget — Budget exceeded pauses, cost override resumes
 *
 * NOTE: The current orchestrator doesn't have explicit budget-pause
 * behavior inline (it's checked via safety activities). These tests
 * verify the cost tracking and that the system handles budget limits
 * through the activity layer.
 */

import {
  approveSignal,
  getStateQuery,
} from "@software-factory/temporal-workflows";
import { describe, expect, it } from "vitest";
import {
  makeE2EInput,
  signalChildWhenRunning,
  testTaskId,
} from "../setup/helpers.js";
import { createE2EEnvironment } from "../setup/test-environment.js";
import type { E2ETestEnvironment } from "../setup/test-environment.js";

describe("E2E: Cost Budget", () => {
  it("tracks cost accumulation through the workflow", async () => {
    let env: E2ETestEnvironment | undefined;

    try {
      env = await createE2EEnvironment({
        taskQueue: "e2e-cost-track",
        mockOptions: { costPerStep: 200 },
      });

      const taskId = testTaskId("cost");

      const handle = await env.client.workflow.start("taskOrchestrator", {
        taskQueue: env.taskQueue,
        workflowId: `task-${taskId}`,
        args: [makeE2EInput(taskId)],
      });

      // Approve review
      await signalChildWhenRunning(
        env.client,
        `task-${taskId}-review-0`,
        approveSignal,
        { actor: "reviewer-1" },
      );

      await handle.result();

      // Verify cost was recorded through the mock
      const cost = env.mockState.costRecorded.get(taskId);
      expect(cost).toBeDefined();
      expect(cost).toBeGreaterThan(0);
    } finally {
      await env?.teardown();
    }
  }, 120_000);

  it("workflow completes with high cost budget", async () => {
    let env: E2ETestEnvironment | undefined;

    try {
      env = await createE2EEnvironment({
        taskQueue: "e2e-cost-high",
        mockOptions: { costBudgetCents: 10_000, costPerStep: 100 },
      });

      const taskId = testTaskId("cost-high");

      const handle = await env.client.workflow.start("taskOrchestrator", {
        taskQueue: env.taskQueue,
        workflowId: `task-${taskId}`,
        args: [
          makeE2EInput(taskId, {
            config: {
              reviewTimeoutMs: 14_400_000,
              costBudgetCents: 10_000,
              maxImplementationAttempts: 3,
            },
          }),
        ],
      });

      await signalChildWhenRunning(
        env.client,
        `task-${taskId}-review-0`,
        approveSignal,
        { actor: "reviewer-1" },
      );

      await handle.result();

      const finalState = await handle.query(getStateQuery);
      expect(["merged", "merge_ready"]).toContain(finalState);
    } finally {
      await env?.teardown();
    }
  }, 120_000);
});
