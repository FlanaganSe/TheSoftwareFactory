/**
 * E2E: Safety Controls — Kill switch with mock activities, merge readiness failure
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
import {
  createMockActivities,
  createMockState,
} from "../setup/mock-activities.js";
import { createCustomE2EEnvironment } from "../setup/test-environment.js";
import type { E2ETestEnvironment } from "../setup/test-environment.js";

describe("E2E: Safety Controls", () => {
  it("merge readiness failure results in failed state", async () => {
    let env: E2ETestEnvironment | undefined;

    try {
      // Activities where merge readiness check fails
      const mockState = createMockState();
      const activities = createMockActivities({
        state: mockState,
        mergeNotReady: true,
      });

      env = await createCustomE2EEnvironment({
        taskQueue: "e2e-safety-merge-fail",
        activities,
        mockState,
      });

      const taskId = testTaskId("safety-merge");

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

      const finalState = await handle.query(getStateQuery);
      // With merge not ready, the task should fail
      expect(finalState).toBe("failed");
    } finally {
      await env?.teardown();
    }
  }, 120_000);

  it("activity-level kill switch results in cancelled workflow", async () => {
    let env: E2ETestEnvironment | undefined;

    try {
      // Activities with a global kill switch active
      const mockState = createMockState();
      const activities = createMockActivities({
        state: mockState,
        globalKill: true,
      });

      env = await createCustomE2EEnvironment({
        taskQueue: "e2e-safety-kill-activity",
        activities,
        mockState,
      });

      const taskId = testTaskId("safety-kill");

      const handle = await env.client.workflow.start("taskOrchestrator", {
        taskQueue: env.taskQueue,
        workflowId: `task-${taskId}`,
        args: [makeE2EInput(taskId)],
      });

      // The workflow should fail because kill check returns killed=true
      // at the activity level. This causes a non-retryable ApplicationFailure.
      await expect(handle.result()).rejects.toThrow();
    } finally {
      await env?.teardown();
    }
  }, 120_000);
});
