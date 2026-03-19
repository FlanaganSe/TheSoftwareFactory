import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let testEnv: TestWorkflowEnvironment;

const makeCapabilitySnapshot = (overrides?: {
  mergeQueue?: {
    enabled: boolean;
    mergeMethod: string;
    minEntriesToMerge: number;
    maxEntriesToMerge: number;
    groupingStrategy: string;
    checkResponseTimeout: number;
  } | null;
  allowedMergeStrategies?: readonly string[];
}) => ({
  repoId: "00000000-0000-0000-0000-000000000001",
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
  mergeQueue: overrides?.mergeQueue ?? null,
  allowedMergeStrategies: overrides?.allowedMergeStrategies ?? ["squash"],
  requiredStatusChecks: [],
  requiredWorkflows: [],
  requiresSignedCommits: false,
  requiresLinearHistory: false,
  requiresConversationResolution: false,
  dismissesStaleReviews: false,
  requiredReviewCount: 1,
  requiresCodeOwnerReview: false,
  lastPusherCannotApprove: false,
  hasPullRequestTargetWorkflows: false,
  pullRequestTargetWorkflowPaths: [],
  pushRestrictions: null,
  bypassActors: [],
  environments: [],
  repoClass: "A" as const,
  supportedByFactory: true,
  unsupportedReasons: [],
  warnings: [],
});

const baseInput = {
  taskId: "t1",
  repoId: "repo-1",
  owner: "test-org",
  repo: "test-repo",
  candidateBranch: "factory/t1/attempt-1",
  baseBranch: "main",
  objective: "Add feature X",
  headSha: "def456",
  attemptNumber: 1,
  evidenceLocator: {
    taskId: "t1",
    attemptNumber: 1,
    bundleId: "bundle-001",
    artifactPrefix: "evidence/t1/1/",
    evidenceJsonKey: "evidence/t1/1/evidence.json",
    manifestKey: "evidence/t1/1/manifest.json",
    diffPatchKey: "evidence/t1/1/diff.patch",
    createdAt: new Date().toISOString(),
  },
  riskSummary: {
    hardBlockers: [],
    softConcerns: [],
    humanJudgmentRequired: [],
    informational: ["1 lint warning(s)"],
  },
  validationPassed: true,
  validationResult: {
    testResults: { passed: 5, failed: 0, skipped: 0 },
    lintResults: { errorCount: 0, warningCount: 1 },
    securityScanResults: {
      vulnerabilities: [],
      criticalCount: 0,
      highCount: 0,
    },
    blastRadius: { files: 2, packages: 1 },
    revertabilityClass: "clean_revert",
  },
  capabilitySnapshot: makeCapabilitySnapshot(),
  changedFiles: [{ path: "src/index.ts" }],
};

const allPassActivities = {
  checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
  transitionTaskState: async () => ({
    id: "t1",
    state: "pr_created" as const,
    objective: "Add feature X",
    scope: null,
    constraints: null,
    budgetCents: null,
    repoId: "repo-1",
    autonomyLevel: "L1",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  createPullRequest: async () => ({
    prNumber: 42,
    prUrl: "https://github.com/test-org/test-repo/pull/42",
    prNodeId: "PR_node123",
    headSha: "def456",
  }),
  createFactoryCheckRun: async () => ({
    checkRunId: 100,
    checkRunUrl: "https://github.com/test-org/test-repo/runs/100",
  }),
  uploadSarif: async () => {},
  enableAutoMerge: async () => {},
  enqueuePullRequest: async () => {},
  createReviewState: async () => {},
};

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("prCreationPhase", () => {
  it("PR created successfully — returns prNumber, prUrl, prNodeId", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-pr-create-pass",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: allPassActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("prCreationPhase", {
        taskQueue: "test-pr-create-pass",
        workflowId: "pr-create-pass-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.taskId).toBe("t1");
      expect(result.prNumber).toBe(42);
      expect(result.prUrl).toBe(
        "https://github.com/test-org/test-repo/pull/42",
      );
      expect(result.prNodeId).toBe("PR_node123");
    });
  });

  it("check run created with correct conclusion", async () => {
    let capturedCheckRunConfig: Record<string, unknown> | undefined;

    const trackingActivities = {
      ...allPassActivities,
      createFactoryCheckRun: async (config: Record<string, unknown>) => {
        capturedCheckRunConfig = config;
        return { checkRunId: 200, checkRunUrl: "https://example.com/runs/200" };
      },
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-pr-checkrun",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: trackingActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("prCreationPhase", {
        taskQueue: "test-pr-checkrun",
        workflowId: "pr-checkrun-1",
        args: [baseInput],
      });

      const result = await handle.result();
      expect(result.checkRunId).toBe(200);
      expect(capturedCheckRunConfig).toBeDefined();
      expect(capturedCheckRunConfig?.validationPassed).toBe(true);
      expect(capturedCheckRunConfig?.headSha).toBe("def456");
      expect(capturedCheckRunConfig?.taskId).toBe("t1");
    });
  });

  it("kill switch checked — kills workflow if active", async () => {
    const killActivities = {
      ...allPassActivities,
      checkKillSwitch: async () => ({
        killed: true,
        scope: "global" as const,
      }),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-pr-kill",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: killActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("prCreationPhase", {
        taskQueue: "test-pr-kill",
        workflowId: "pr-kill-1",
        workflowExecutionTimeout: "30s",
        args: [baseInput],
      });

      try {
        await handle.result();
        expect.unreachable("should have thrown");
      } catch (e) {
        // Kill switch properly prevented PR creation — workflow fails
        expect(e).toBeDefined();
      }
    });
  }, 60_000);

  it("new execution takes patched path with legacy-shaped input", async () => {
    // New executions always take the patched path (patched() returns true).
    // When given a legacy-shaped input, the full path runs but uses
    // the input fields as-is. Since taskId is provided, activities are called.
    const legacyInput = {
      ...baseInput,
      taskId: "t-legacy",
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-pr-legacy",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: allPassActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("prCreationPhase", {
        taskQueue: "test-pr-legacy",
        workflowId: "pr-legacy-1",
        args: [legacyInput],
      });

      const result = await handle.result();
      expect(result.taskId).toBe("t-legacy");
      expect(result.prNumber).toBe(42);
    });
  });

  it("auto-merge enabled when merge queue configured", async () => {
    let enqueueCalledWith:
      | { owner: string; repo: string; prNodeId: string }
      | undefined;

    const mergeQueueActivities = {
      ...allPassActivities,
      enqueuePullRequest: async (
        owner: string,
        repo: string,
        prNodeId: string,
      ) => {
        enqueueCalledWith = { owner, repo, prNodeId };
      },
    };

    const mergeQueueInput = {
      ...baseInput,
      capabilitySnapshot: makeCapabilitySnapshot({
        mergeQueue: {
          enabled: true,
          mergeMethod: "squash",
          minEntriesToMerge: 1,
          maxEntriesToMerge: 5,
          groupingStrategy: "ALLGREEN",
          checkResponseTimeout: 60,
        },
      }),
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-pr-mergequeue",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mergeQueueActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("prCreationPhase", {
        taskQueue: "test-pr-mergequeue",
        workflowId: "pr-mergequeue-1",
        args: [mergeQueueInput],
      });

      const result = await handle.result();
      expect(result.autoMergeEnabled).toBe(true);
      expect(enqueueCalledWith).toBeDefined();
      expect(enqueueCalledWith?.owner).toBe("test-org");
      expect(enqueueCalledWith?.repo).toBe("test-repo");
      expect(enqueueCalledWith?.prNodeId).toBe("PR_node123");
    });
  });

  it("review state persisted when evidenceBundleId provided", async () => {
    let capturedReviewState: Record<string, unknown> | undefined;

    const reviewStateActivities = {
      ...allPassActivities,
      createReviewState: async (input: Record<string, unknown>) => {
        capturedReviewState = input;
      },
    };

    const inputWithBundle = {
      ...baseInput,
      evidenceBundleId: "bundle-001",
    };

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-pr-review-state",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: reviewStateActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("prCreationPhase", {
        taskQueue: "test-pr-review-state",
        workflowId: "pr-review-state-1",
        args: [inputWithBundle],
      });

      await handle.result();
      expect(capturedReviewState).toBeDefined();
      expect(capturedReviewState?.taskId).toBe("t1");
      expect(capturedReviewState?.evidenceBundleId).toBe("bundle-001");
      expect(capturedReviewState?.prNumber).toBe(42);
      expect(capturedReviewState?.prUrl).toBe(
        "https://github.com/test-org/test-repo/pull/42",
      );
      expect(capturedReviewState?.prNodeId).toBe("PR_node123");
      expect(capturedReviewState?.headSha).toBe("def456");
    });
  });

  it("review state not persisted when evidenceBundleId omitted", async () => {
    let reviewStateCalled = false;

    const noReviewActivities = {
      ...allPassActivities,
      createReviewState: async () => {
        reviewStateCalled = true;
      },
    };

    // baseInput does not include evidenceBundleId
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-pr-no-review",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: noReviewActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("prCreationPhase", {
        taskQueue: "test-pr-no-review",
        workflowId: "pr-no-review-1",
        args: [baseInput],
      });

      await handle.result();
      expect(reviewStateCalled).toBe(false);
    });
  });
});
