import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let testEnv: TestWorkflowEnvironment;

const mockCapabilitySnapshot = {
  repoId: "repo-1",
  capturedAt: new Date().toISOString(),
  sourceRevision: "abc123",
  defaultBranch: "main",
  visibility: "private" as const,
  isArchived: false,
  isFork: false,
  hasWiki: false,
  hasProjects: false,
  branchProtection: null,
  rulesets: [],
  hasInheritedRulesets: false,
  codeowners: null,
  mergeQueue: null,
  allowedMergeStrategies: ["squash" as const],
  requiredStatusChecks: [],
  requiredWorkflows: [],
  requiresSignedCommits: false,
  requiresLinearHistory: false,
  requiresConversationResolution: false,
  dismissesStaleReviews: false,
  requiredReviewCount: 0,
  requiresCodeOwnerReview: false,
  lastPusherCannotApprove: false,
  hasPullRequestTargetWorkflows: false,
  pullRequestTargetWorkflowPaths: [],
  pushRestrictions: null,
  bypassActors: [],
  environments: [],
  repoClass: "C" as const,
  supportedByFactory: true,
  unsupportedReasons: [],
  warnings: [],
};

const mockIndexResult = {
  indexVersionId: "idx-1",
  totalFiles: 10,
  indexedFiles: 8,
  excludedFiles: 2,
  symbolCount: 50,
  dependencyCount: 20,
  durationMs: 1000,
  repoMap: [
    {
      filePath: "src/index.ts",
      rank: 1.0,
      keySymbols: ["main"],
      lineCount: 50,
    },
    {
      filePath: "src/utils.ts",
      rank: 0.8,
      keySymbols: ["helper"],
      lineCount: 30,
    },
  ],
};

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

const mockTrustedContext = {
  baseSha: "abc123",
  setupContract: null,
  policySnapshot: [],
  behavioralControlFiles: {},
  validationCommandSources: [],
  capturedAt: new Date().toISOString(),
};

const mockActivities = {
  checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
  transitionTaskState: async (_taskId: string, newState: string) => ({
    ...mockTaskRecord,
    state: newState,
  }),
  cloneRepo: async (_owner: string, _repo: string, targetPath: string) => ({
    path: targetPath,
    headSha: "abc123",
  }),
  captureTrustedContext: async () => mockTrustedContext,
  scanRepository: async () => mockCapabilitySnapshot,
  indexRepositoryActivity: async () => mockIndexResult,
};

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("understandPhase", () => {
  it("runs capability scan and indexing → produces repo map", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-understand-1",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("understandPhase", {
        taskQueue: "test-understand-1",
        workflowId: "understand-1",
        args: [
          {
            taskId: "t1",
            repoId: "repo-1",
            objective: "Add a README",
            repoOwner: "owner",
            repoName: "repo",
            repoPath: "/tmp/repo",
            baseSha: "abc123",
          },
        ],
      });

      const result = await handle.result();
      expect(result.taskId).toBe("t1");
      expect(result.capabilitySnapshot.defaultBranch).toBe("main");
      expect(result.repoMap.length).toBe(2);
      expect(result.relevantFiles).toContain("src/index.ts");
      expect(result.indexVersionId).toBe("idx-1");
    });
  });

  it("checks kill switch before work", async () => {
    let scanCalled = false;
    const killedActivities = {
      ...mockActivities,
      checkKillSwitch: async () => ({ killed: true, scope: "task" as const }),
      scanRepository: async () => {
        scanCalled = true;
        return mockCapabilitySnapshot;
      },
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-understand-kill",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: killedActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("understandPhase", {
        taskQueue: "test-understand-kill",
        workflowId: "understand-kill-1",
        retry: { maximumAttempts: 1 },
        args: [
          {
            taskId: "t2",
            repoId: "repo-1",
            objective: "Test",
            repoOwner: "owner",
            repoName: "repo",
            repoPath: "/tmp/repo",
            baseSha: "abc123",
          },
        ],
      });

      try {
        await handle.result();
        expect.unreachable("should have thrown");
      } catch {
        // Workflow failed as expected
      }

      // Scan should NOT have been called — kill check aborted first
      expect(scanCalled).toBe(false);
    });
  });

  it("propagates indexing errors", async () => {
    const failActivities = {
      ...mockActivities,
      indexRepositoryActivity: async () => {
        throw new Error("indexing failed");
      },
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-understand-fail",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: failActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("understandPhase", {
        taskQueue: "test-understand-fail",
        workflowId: "understand-fail-1",
        retry: { maximumAttempts: 1 },
        args: [
          {
            taskId: "t3",
            repoId: "repo-1",
            objective: "Test",
            repoOwner: "owner",
            repoName: "repo",
            repoPath: "/tmp/repo",
            baseSha: "abc123",
          },
        ],
      });

      try {
        await handle.result();
        expect.unreachable("should have thrown");
      } catch {
        // Error propagated as expected
      }
    });
  });

  it("transitions task state to in_progress", async () => {
    let transitionedState = "";
    const trackingActivities = {
      ...mockActivities,
      transitionTaskState: async (_taskId: string, newState: string) => {
        transitionedState = newState;
        return { ...mockTaskRecord, state: newState };
      },
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-understand-state",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: trackingActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("understandPhase", {
        taskQueue: "test-understand-state",
        workflowId: "understand-state-1",
        args: [
          {
            taskId: "t4",
            repoId: "repo-1",
            objective: "Test",
            repoOwner: "owner",
            repoName: "repo",
            repoPath: "/tmp/repo",
            baseSha: "abc123",
          },
        ],
      });

      await handle.result();
      expect(transitionedState).toBe("in_progress");
    });
  });
});
