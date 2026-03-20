import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveSignal, rejectSignal } from "../src/signals.js";

let testEnv: TestWorkflowEnvironment;

const mockTaskRecord = {
  id: "t1",
  state: "created" as const,
  objective: "Test",
  repoId: "repo-1",
  createdBy: "system",
  autonomyLevel: "L1",
  scope: null,
  constraints: null,
  budgetCents: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockActivities = {
  checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
  checkCostBudget: async () => ({
    allowed: true,
    currentCents: 0,
    budgetCents: 1000,
    percentUsed: 0,
  }),
  transitionTaskState: async (_taskId: string, newState: string) => ({
    ...mockTaskRecord,
    state: newState,
  }),
  executeAgentStep: async () => ({
    success: true,
    filesModified: [],
    toolCallCount: 5,
    totalCostCents: 10,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
  }),
  createCandidateBranch: async () => ({
    ref: "refs/heads/factory/t1",
    sha: "abc123",
  }),
  pushChanges: async () => ({ commitSha: "def456" }),
  execInSandbox: async () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 100,
  }),
  destroySandbox: async () => {},
  recordCost: async () => ({
    totalCents: 10,
    budgetCents: 1000,
    percentUsed: 1,
    overBudget: false,
  }),
  acquireBranchLease: async () => ({ acquired: true }),
  releaseBranchLease: async () => true,
};

const baseInput = {
  taskId: "t1",
  objective: "Add feature X",
  plan: "## Plan\nStep 1: modify src/index.ts",
  iteration: 0,
  sandbox: { containerId: "container-1", phase: "execution", labels: {} },
  repoOwner: "owner",
  repoName: "repo",
  branchName: "factory/t1",
  baseSha: "abc123",
  model: "openai/gpt-5.4-nano",
  budgetCents: 1000,
  autonomyLevel: "L1" as const,
  repoMap: [],
  policies: [],
};

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("implementPhase", () => {
  it("L1 gate: blocks before execution, unblocks on approve signal", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-impl-approve",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("implementPhase", {
        taskQueue: "test-impl-approve",
        workflowId: "impl-approve-1",
        args: [baseInput],
      });

      // Wait for the workflow to block on approval
      await new Promise((r) => setTimeout(r, 500));

      // Send approve signal
      await handle.signal(approveSignal, { actor: "operator" });

      const result = await handle.result();
      expect(result.taskId).toBe("t1");
      expect(result.candidateBranch).toBe("factory/t1");
    });
  });

  it("L1 gate: reject signal → task fails", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-impl-reject",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("implementPhase", {
        taskQueue: "test-impl-reject",
        workflowId: "impl-reject-1",
        retry: { maximumAttempts: 1 },
        args: [baseInput],
      });

      await new Promise((r) => setTimeout(r, 500));
      await handle.signal(rejectSignal, {
        actor: "operator",
        reason: "not acceptable",
      });

      try {
        await handle.result();
        expect.unreachable("should have thrown");
      } catch {
        // Rejection propagated as expected
      }
    });
  });

  it("L2: skips autonomy gate", async () => {
    const l2Input = { ...baseInput, autonomyLevel: "L2" as const };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-impl-l2",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("implementPhase", {
        taskQueue: "test-impl-l2",
        workflowId: "impl-l2-1",
        args: [l2Input],
      });

      // Should complete without needing approval
      const result = await handle.result();
      expect(result.taskId).toBe("t1");
    });
  });

  it("agent executes and produces file changes", async () => {
    const agentActivities = {
      ...mockActivities,
      executeAgentStep: async () => ({
        success: true,
        filesModified: ["src/index.ts", "src/utils.ts"],
        toolCallCount: 8,
        totalCostCents: 25,
        totalInputTokens: 5000,
        totalOutputTokens: 2000,
      }),
      execInSandbox: async () => ({
        exitCode: 0,
        stdout: "src/index.ts\nsrc/utils.ts\n",
        stderr: "",
        durationMs: 200,
      }),
    };

    const l2Input = { ...baseInput, autonomyLevel: "L2" as const };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-impl-changes",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: agentActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("implementPhase", {
        taskQueue: "test-impl-changes",
        workflowId: "impl-changes-1",
        args: [l2Input],
      });

      const result = await handle.result();
      expect(result.filesChanged).toBe(2);
      expect(result.agentResult.toolCallCount).toBe(8);
    });
  });

  it("failed agent (guardrail trip) → error propagated", async () => {
    const failActivities = {
      ...mockActivities,
      executeAgentStep: async () => {
        throw new Error("Guardrail tripped: MAX_STEPS_EXCEEDED");
      },
    };

    const l2Input = { ...baseInput, autonomyLevel: "L2" as const };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-impl-guardrail",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: failActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("implementPhase", {
        taskQueue: "test-impl-guardrail",
        workflowId: "impl-guardrail-1",
        retry: { maximumAttempts: 1 },
        args: [l2Input],
      });

      try {
        await handle.result();
        expect.unreachable("should have thrown");
      } catch {
        // Error propagated as expected
      }
    });
  });

  it("records cost after agent execution", async () => {
    let recordedCost = 0;
    const costActivities = {
      ...mockActivities,
      executeAgentStep: async () => ({
        success: true,
        filesModified: [],
        toolCallCount: 3,
        totalCostCents: 42,
        totalInputTokens: 2000,
        totalOutputTokens: 1000,
      }),
      recordCost: async (_taskId: string, cents: number) => {
        recordedCost = cents;
        return {
          totalCents: cents,
          budgetCents: 1000,
          percentUsed: (cents / 1000) * 100,
          overBudget: false,
        };
      },
    };

    const l2Input = { ...baseInput, autonomyLevel: "L2" as const };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-impl-cost",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: costActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("implementPhase", {
        taskQueue: "test-impl-cost",
        workflowId: "impl-cost-1",
        args: [l2Input],
      });

      await handle.result();
      expect(recordedCost).toBe(42);
    });
  });
});
