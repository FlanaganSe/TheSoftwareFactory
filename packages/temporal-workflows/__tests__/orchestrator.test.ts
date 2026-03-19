import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskWorkflowInput } from "../src/orchestrator.js";
import {
  approveSignal,
  changesRequestedSignal,
  getPhaseQuery,
  getProgressQuery,
  getStateQuery,
  killSignal,
  rejectSignal,
} from "../src/signals.js";

let testEnv: TestWorkflowEnvironment;

const defaultInput: TaskWorkflowInput = {
  taskId: "t1",
  repoId: "repo-1",
  objective: "Add a README",
  autonomyLevel: "L1",
  config: {
    reviewTimeoutMs: 14_400_000,
    costBudgetCents: 1000,
    maxImplementationAttempts: 3,
  },
};

const mockActivities = {
  createTask: async () => ({
    id: "t1",
    state: "created",
    objective: "Add a README",
    repoId: "repo-1",
    createdBy: "system",
    autonomyLevel: "L1",
    scope: null,
    constraints: null,
    budgetCents: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  transitionTaskState: async (_taskId: string, newState: string) => ({
    id: "t1",
    state: newState,
    objective: "Add a README",
    repoId: "repo-1",
    createdBy: "system",
    autonomyLevel: "L1",
    scope: null,
    constraints: null,
    budgetCents: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getTask: async () => ({
    id: "t1",
    state: "assigned",
  }),
  listActiveTasks: async () => [],
  checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
  checkCostBudget: async () => ({
    allowed: true,
    currentCents: 0,
    budgetCents: 1000,
    percentUsed: 0,
  }),
  insertAuditEntry: async () => {},
  acquireBranchLease: async () => ({ acquired: true }),
  releaseBranchLease: async () => true,
  renewBranchLease: async () => true,
  recordCost: async () => ({
    totalCents: 0,
    budgetCents: 1000,
    percentUsed: 0,
    overBudget: false,
  }),
};

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("taskOrchestrator", () => {
  it("starts and progresses through phases", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-start",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-start",
        workflowId: "orch-start-1",
        args: [defaultInput],
      });

      // Wait briefly for workflow to progress
      await new Promise((r) => setTimeout(r, 500));

      const progress = await handle.query(getProgressQuery);
      expect(progress.taskId).toBe("t1");

      // Kill to end cleanly
      await handle.signal(killSignal, { actor: "test" });
      await handle.result();
    });
  });

  it("responds to kill signal between phases", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-kill",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-kill",
        workflowId: "orch-kill-1",
        args: [defaultInput],
      });

      await new Promise((r) => setTimeout(r, 200));
      await handle.signal(killSignal, {
        actor: "operator",
        reason: "emergency",
      });
      await handle.result();

      const state = await handle.query(getStateQuery);
      expect(state).toBe("cancelled");
    });
  });

  it("queries return valid progress", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-q",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-q",
        workflowId: "orch-q-1",
        args: [defaultInput],
      });

      await new Promise((r) => setTimeout(r, 300));

      const progress = await handle.query(getProgressQuery);
      expect(progress.taskId).toBe("t1");
      expect(progress.attemptNumber).toBe(1);
      expect(progress.startedAt).toBeTruthy();

      const phase = await handle.query(getPhaseQuery);
      expect(typeof phase).toBe("string");

      await handle.signal(killSignal, { actor: "test" });
      await handle.result();
    });
  });

  it("approve signal to child review → continues to pr_creation and completes", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-approve",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-approve",
        workflowId: "orch-approve-1",
        args: [
          {
            ...defaultInput,
            taskId: "approve1",
          },
        ],
      });

      // Signal the child review workflow directly
      // Child ID = task-{taskId}-review
      const reviewHandle = testEnv.client.workflow.getHandle(
        "task-approve1-review-0",
      );

      // Poll until child review workflow exists
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const desc = await reviewHandle.describe();
          if (desc.status.name === "RUNNING") {
            await reviewHandle.signal(approveSignal, { actor: "reviewer" });
            break;
          }
        } catch {
          // Child not started yet
        }
      }

      await handle.result();
      const finalState = await handle.query(getStateQuery);
      expect(finalState).toBe("merged");
    });
  });

  it("reject signal to child review → workflow transitions to failed", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-reject",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-reject",
        workflowId: "orch-reject-1",
        args: [
          {
            ...defaultInput,
            taskId: "reject1",
          },
        ],
      });

      const reviewHandle = testEnv.client.workflow.getHandle(
        "task-reject1-review-0",
      );

      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const desc = await reviewHandle.describe();
          if (desc.status.name === "RUNNING") {
            await reviewHandle.signal(rejectSignal, {
              actor: "reviewer",
              reason: "not acceptable",
            });
            break;
          }
        } catch {
          // Child not started yet
        }
      }

      await handle.result();
      const finalState = await handle.query(getStateQuery);
      expect(finalState).toBe("failed");
    });
  });

  it("changes_requested signal loops back to implement", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-changes",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-changes",
        workflowId: "orch-changes-1",
        args: [
          {
            ...defaultInput,
            taskId: "changes1",
          },
        ],
      });

      // First review: send changes_requested
      const review1Handle = testEnv.client.workflow.getHandle(
        "task-changes1-review-0",
      );
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const desc = await review1Handle.describe();
          if (desc.status.name === "RUNNING") {
            await review1Handle.signal(changesRequestedSignal, {
              actor: "reviewer",
              message: "fix tests",
            });
            break;
          }
        } catch {
          // Not started yet
        }
      }

      // After changes_requested, the orchestrator loops back to implement.
      // phaseIteration increments to 1, so the second review child ID is review-1.
      await new Promise((r) => setTimeout(r, 1000));

      // Check phaseIteration increased
      const progress = await handle.query(getProgressQuery);
      expect(progress.phaseIteration).toBeGreaterThanOrEqual(1);

      // Approve the second review (iteration 1) to let workflow complete
      const review2Handle = testEnv.client.workflow.getHandle(
        "task-changes1-review-1",
      );
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const desc = await review2Handle.describe();
          if (desc.status.name === "RUNNING") {
            await review2Handle.signal(approveSignal, { actor: "reviewer" });
            break;
          }
        } catch {
          // Not started yet
        }
      }

      await handle.result();
    });
  });
});
