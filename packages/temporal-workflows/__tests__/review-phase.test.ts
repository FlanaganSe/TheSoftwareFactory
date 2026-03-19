import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReviewResult } from "../src/phases/review.js";
import {
  approveSignal,
  changesRequestedSignal,
  rejectSignal,
} from "../src/signals.js";

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

async function createWorkerAndRun<T>(fn: () => Promise<T>): Promise<T> {
  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: "test-review",
    workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
    activities: {
      transitionTaskState: async () => ({ id: "t1", state: "failed" }),
      insertAuditEntry: async () => {},
    },
  });
  return await worker.runUntil(fn);
}

describe("reviewPhase", () => {
  it("returns approved when approve signal is sent", async () => {
    const result = await createWorkerAndRun(async () => {
      const handle = await testEnv.client.workflow.start("reviewPhase", {
        taskQueue: "test-review",
        workflowId: "review-approve",
        args: [{ taskId: "t1", reviewTimeoutMs: 14_400_000 }],
      });
      await handle.signal(approveSignal, { actor: "reviewer" });
      return (await handle.result()) as ReviewResult;
    });

    expect(result.outcome).toBe("approved");
    expect(result.actor).toBe("reviewer");
  });

  it("returns rejected when reject signal is sent", async () => {
    const result = await createWorkerAndRun(async () => {
      const handle = await testEnv.client.workflow.start("reviewPhase", {
        taskQueue: "test-review",
        workflowId: "review-reject",
        args: [{ taskId: "t1", reviewTimeoutMs: 14_400_000 }],
      });
      await handle.signal(rejectSignal, {
        actor: "reviewer",
        reason: "not good enough",
      });
      return (await handle.result()) as ReviewResult;
    });

    expect(result.outcome).toBe("rejected");
    expect(result.message).toBe("not good enough");
  });

  it("returns changes_requested when changes signal is sent", async () => {
    const result = await createWorkerAndRun(async () => {
      const handle = await testEnv.client.workflow.start("reviewPhase", {
        taskQueue: "test-review",
        workflowId: "review-changes",
        args: [{ taskId: "t1", reviewTimeoutMs: 14_400_000 }],
      });
      await handle.signal(changesRequestedSignal, {
        actor: "reviewer",
        message: "fix the tests",
      });
      return (await handle.result()) as ReviewResult;
    });

    expect(result.outcome).toBe("changes_requested");
    expect(result.message).toBe("fix the tests");
  });

  it("times out after configured timeout", async () => {
    const result = await createWorkerAndRun(async () => {
      const handle = await testEnv.client.workflow.start("reviewPhase", {
        taskQueue: "test-review",
        workflowId: "review-timeout",
        args: [{ taskId: "t1", reviewTimeoutMs: 3_600_000 }], // 1 hour
      });
      // Time-skipping environment will fast-forward
      return (await handle.result()) as ReviewResult;
    });

    expect(result.outcome).toBe("timed_out");
  });

  it("first signal wins when multiple signals sent", async () => {
    const result = await createWorkerAndRun(async () => {
      const handle = await testEnv.client.workflow.start("reviewPhase", {
        taskQueue: "test-review",
        workflowId: "review-first-wins",
        args: [{ taskId: "t1", reviewTimeoutMs: 14_400_000 }],
      });
      await handle.signal(approveSignal, { actor: "reviewer1" });
      await handle.signal(rejectSignal, {
        actor: "reviewer2",
        reason: "too late",
      });
      return (await handle.result()) as ReviewResult;
    });

    expect(result.outcome).toBe("approved");
    expect(result.actor).toBe("reviewer1");
  });
});
