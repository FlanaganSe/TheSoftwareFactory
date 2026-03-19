import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LearnFullResult } from "../src/phases/learn.js";

let testEnv: TestWorkflowEnvironment;

const baseMockActivities = {
  checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
  transitionTaskState: async (_taskId: string, newState: string) => ({
    id: "t1",
    state: newState,
    objective: "test",
    scope: null,
    constraints: null,
    budgetCents: null,
    repoId: "repo-1",
    autonomyLevel: "L2",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  insertAuditEntry: async () => {},
};

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

function createWorker(
  taskQueue: string,
  activities = baseMockActivities,
): Promise<Worker> {
  return Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue,
    workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
    activities,
  });
}

const fullInput = {
  taskId: "t1",
  repoId: "repo-1",
  owner: "test-org",
  repo: "test-repo",
  merged: true,
  mergedSha: "merge-sha-abc",
  attemptNumber: 1,
  phaseIteration: 0,
  totalCostCents: 42,
  startedAt: "2026-03-19T00:00:00.000Z",
  completedAt: "2026-03-19T01:00:00.000Z",
  filesChanged: 5,
};

describe("learnPhase", () => {
  it("records metrics for a successful merge", async () => {
    const worker = await createWorker("test-learn-success");
    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("learnPhase", {
        taskQueue: "test-learn-success",
        workflowId: "learn-success-1",
        args: [fullInput],
      });
      return (await handle.result()) as LearnFullResult;
    });

    expect(result.taskId).toBe("t1");
    expect(result.lessonsLearned).toBe(1);
    expect(result.metrics.merged).toBe(true);
    expect(result.metrics.attemptCount).toBe(1);
    expect(result.metrics.totalCostCents).toBe(42);
    expect(result.metrics.filesChanged).toBe(5);
  });

  it("computes duration from creation to completion", async () => {
    const worker = await createWorker("test-learn-duration");
    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("learnPhase", {
        taskQueue: "test-learn-duration",
        workflowId: "learn-duration-1",
        args: [fullInput],
      });
      return (await handle.result()) as LearnFullResult;
    });

    // 1 hour = 3_600_000 ms
    expect(result.metrics.durationMs).toBe(3_600_000);
  });

  it("captures attempt count and iteration count", async () => {
    const worker = await createWorker("test-learn-counts");
    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("learnPhase", {
        taskQueue: "test-learn-counts",
        workflowId: "learn-counts-1",
        args: [{ ...fullInput, attemptNumber: 3, phaseIteration: 2 }],
      });
      return (await handle.result()) as LearnFullResult;
    });

    expect(result.metrics.attemptCount).toBe(3);
    expect(result.metrics.phaseIterations).toBe(2);
  });

  it("total cost accumulated correctly", async () => {
    const worker = await createWorker("test-learn-cost");
    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("learnPhase", {
        taskQueue: "test-learn-cost",
        workflowId: "learn-cost-1",
        args: [{ ...fullInput, totalCostCents: 150 }],
      });
      return (await handle.result()) as LearnFullResult;
    });

    expect(result.metrics.totalCostCents).toBe(150);
  });

  it("learn failure is non-blocking — returns result even if audit fails", async () => {
    const failingActivities = {
      ...baseMockActivities,
      insertAuditEntry: async () => {
        throw new Error("DB connection lost");
      },
      transitionTaskState: async () => {
        throw new Error("Already in terminal state");
      },
    };

    const worker = await createWorker("test-learn-fail", failingActivities);
    const result = await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("learnPhase", {
        taskQueue: "test-learn-fail",
        workflowId: "learn-fail-1",
        args: [fullInput],
      });
      // Should not throw even though activities fail
      return (await handle.result()) as LearnFullResult;
    });

    // Still returns valid result despite errors
    expect(result.taskId).toBe("t1");
    expect(result.metrics.merged).toBe(true);
  });
});
