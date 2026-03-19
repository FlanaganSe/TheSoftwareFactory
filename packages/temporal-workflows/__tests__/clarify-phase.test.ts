import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClarifyResult } from "../src/phases/clarify.js";
import { clarifyResponseSignal } from "../src/signals.js";

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
    taskQueue: "test-clarify",
    workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
    activities: {
      transitionTaskState: async () => ({
        id: "t1",
        state: "assigned",
      }),
    },
  });
  return await worker.runUntil(fn);
}

describe("clarifyPhase", () => {
  it("unblocks when clarify response signal is received", async () => {
    const result = await createWorkerAndRun(async () => {
      const handle = await testEnv.client.workflow.start("clarifyPhase", {
        taskQueue: "test-clarify",
        workflowId: "clarify-response",
        args: [{ taskId: "t1", objective: "Do something" }],
      });
      await handle.signal(clarifyResponseSignal, {
        actor: "human",
        response: "Please add tests",
      });
      return (await handle.result()) as ClarifyResult;
    });

    expect(result.state).toBe("assigned");
    expect(result.updatedObjective).toContain("Please add tests");
    expect(result.updatedObjective).toContain("Do something");
  });

  it("stays blocked without signal (does not complete on its own)", async () => {
    let completed = false;

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-clarify-block",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: {
        transitionTaskState: async () => ({
          id: "t1",
          state: "assigned",
        }),
      },
    });

    const promise = worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("clarifyPhase", {
        taskQueue: "test-clarify-block",
        workflowId: "clarify-blocked",
        args: [{ taskId: "t1", objective: "Ambiguous" }],
      });

      // Wait a bit, then check it's still running
      await new Promise((r) => setTimeout(r, 2000));
      const desc = await handle.describe();
      expect(desc.status.name).toBe("RUNNING");

      // Now unblock it
      await handle.signal(clarifyResponseSignal, {
        actor: "human",
        response: "clarified",
      });
      await handle.result();
      completed = true;
    });

    await promise;
    expect(completed).toBe(true);
  });

  it("includes both original and clarified objective in result", async () => {
    const result = await createWorkerAndRun(async () => {
      const handle = await testEnv.client.workflow.start("clarifyPhase", {
        taskQueue: "test-clarify",
        workflowId: "clarify-objective",
        args: [{ taskId: "t1", objective: "Original objective" }],
      });
      await handle.signal(clarifyResponseSignal, {
        actor: "human",
        response: "Add unit tests for auth module",
      });
      return (await handle.result()) as ClarifyResult;
    });

    expect(result.updatedObjective).toContain("Original objective");
    expect(result.updatedObjective).toContain("Add unit tests for auth module");
  });
});
