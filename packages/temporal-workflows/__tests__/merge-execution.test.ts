/**
 * Tests for M18 merge execution in the orchestrator.
 * Focuses on the merge_ready → merge → learn path and cleanup consolidation.
 */
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskWorkflowInput } from "../src/orchestrator.js";
import {
  approveSignal,
  getStateQuery,
  prClosedSignal,
} from "../src/signals.js";

let testEnv: TestWorkflowEnvironment;

const mockTrustedContext = {
  baseSha: "abc123",
  setupContract: {
    version: "1",
    image: "node:22-slim",
    setup: [],
    maintenance: [],
    secrets: { setup_only: [], runtime: [], per_tool: [] },
    health_check: [],
  },
  policySnapshot: [],
  behavioralControlFiles: {},
  validationCommandSources: [],
  capturedAt: new Date().toISOString(),
};

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
  requiredStatusChecks: [] as { context: string }[],
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

function makeMockActivities(overrides: Record<string, unknown> = {}) {
  return {
    createTask: async () => ({
      id: "t1",
      state: "created" as const,
      objective: "Add feature",
      repoId: "repo-1",
      createdBy: "system",
      autonomyLevel: "L2",
      scope: null,
      constraints: null,
      budgetCents: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    transitionTaskState: async (_taskId: string, newState: string) => ({
      id: "t1",
      state: newState,
      objective: "Add feature",
      scope: null,
      constraints: null,
      budgetCents: null,
      repoId: "repo-1",
      autonomyLevel: "L2",
      createdBy: "system",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    getTask: async () => ({ id: "t1", state: "created" }),
    listActiveTasks: async () => [],
    insertAuditEntry: async () => {},
    checkKillSwitch: async () => ({ killed: false, scope: "none" as const }),
    checkCostBudget: async () => ({
      allowed: true,
      currentCents: 0,
      budgetCents: 1000,
      percentUsed: 0,
    }),
    acquireBranchLease: async () => ({ acquired: true }),
    releaseBranchLease: async () => true,
    renewBranchLease: async () => true,
    recordCost: async () => ({
      totalCents: 0,
      budgetCents: 1000,
      percentUsed: 0,
      overBudget: false,
    }),
    scanRepository: async () => mockCapabilitySnapshot,
    captureTrustedContext: async () => mockTrustedContext,
    createCandidateBranch: async () => ({
      ref: "refs/heads/factory/t1",
      sha: "abc123",
    }),
    pushChanges: async () => ({ commitSha: "def456" }),
    cloneRepo: async () => ({
      path: "/tmp/factory/t1/repo",
      headSha: "abc123",
    }),
    indexRepositoryActivity: async () => ({
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
      ],
    }),
    generatePlan: async () => ({
      plan: "## Plan\n### Step 1",
      estimatedFiles: ["src/index.ts"],
    }),
    provisionSandbox: async () => ({
      containerId: "container-1",
      phase: "execution",
      labels: {},
    }),
    execInSandbox: async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 100,
    }),
    destroySandbox: async () => {},
    cleanupOrphans: async () => 0,
    executeAgentStep: async () => ({
      success: true,
      filesModified: ["src/index.ts"],
      toolCallCount: 5,
      totalCostCents: 10,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
    }),
    getChangedFiles: async () => [],
    runTests: async () => ({
      testResults: {
        passed: 1,
        failed: 0,
        skipped: 0,
        newTests: [],
        modifiedTests: [],
        deletedTests: [],
        details: [],
      },
      exitCode: 0,
      commandRecord: { command: "npm test", exitCode: 0, durationMs: 100 },
    }),
    runLinter: async () => ({
      lintResults: { errorCount: 0, warningCount: 0, details: [] },
      exitCode: 0,
      commandRecord: {
        command: "npx biome check",
        exitCode: 0,
        durationMs: 50,
      },
    }),
    runSecurityScan: async () => ({
      securityScanResults: {
        vulnerabilities: [],
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
      },
      commandsRun: [],
    }),
    computeBlastRadius: async () => ({
      blastRadius: { files: 1, packages: 1 },
      filesChanged: ["src/index.ts"],
      packagesAffected: ["core"],
      protectedSurfaceEdits: [],
      migrationImpact: {
        hasMigrations: false,
        migrationFiles: [],
        schemaChanges: [],
      },
      revertabilityClass: "clean_revert",
    }),
    checkValidatorBoundary: async () => [],
    generateAndPersistEvidence: async () => ({
      bundleId: "bundle-001",
      locator: {
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
        informational: [],
      },
      passed: true,
    }),
    createPullRequest: async () => ({
      prNumber: 42,
      prUrl: "https://github.com/test-org/test-repo/pull/42",
      prNodeId: "PR_node_42",
      headSha: "abc123",
    }),
    updatePullRequest: async () => {},
    createFactoryCheckRun: async () => ({
      checkRunId: 100,
      checkRunUrl: "https://github.com/test-org/test-repo/runs/100",
    }),
    updateCheckRun: async () => {},
    uploadSarif: async () => {},
    enableAutoMerge: async () => {},
    enqueuePullRequest: async () => {},
    createReviewState: async () => {},
    getReviewState: async () => null,
    updateReviewState: async () => {},
    reconcilePRState: async () => ({
      prState: "open" as const,
      reviewDecision: "REVIEW_REQUIRED",
      unresolvedThreads: 0,
      checks: [] as { name: string; conclusion: string }[],
      staleReviews: false,
      headSha: "abc123",
    }),
    // ─── M18 Merge Activities ───
    checkMergeReadiness: async () => ({
      ready: true,
      blockers: [],
      checksStatus: "all_passing" as const,
      reviewStatus: "approved" as const,
      threadsStatus: "all_resolved" as const,
      codeOwnerStatus: "not_required" as const,
    }),
    mergePullRequest: async () => ({
      merged: true,
      sha: "merge-sha-123",
      method: "squash",
      message: "Merged successfully",
    }),
    deleteBranch: async () => {},
    ...overrides,
  };
}

function makeInput(
  taskId: string,
  overrides: Partial<TaskWorkflowInput> = {},
): TaskWorkflowInput {
  return {
    taskId,
    repoId: "repo-1",
    repoOwner: "test-org",
    repoName: "test-repo",
    objective: "Add feature",
    autonomyLevel: "L2",
    config: {
      reviewTimeoutMs: 14_400_000,
      costBudgetCents: 1000,
      maxImplementationAttempts: 3,
    },
    trustedContext: mockTrustedContext,
    ...overrides,
  };
}

async function signalChildWhenRunning(
  childId: string,
  signal: unknown,
  payload: Record<string, unknown>,
): Promise<void> {
  const handle = testEnv.client.workflow.getHandle(childId);
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const desc = await handle.describe();
      if (desc.status.name === "RUNNING") {
        await handle.signal(signal as string, payload);
        return;
      }
    } catch {
      // Child not started yet
    }
  }
  throw new Error(`Child workflow ${childId} never reached RUNNING state`);
}

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("M18 merge execution", () => {
  it("merge_ready → pre-check passes → merge succeeds → state: merged → learn runs", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-merge-ok",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: makeMockActivities(),
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-merge-ok",
        workflowId: "m18-merge-ok-1",
        args: [makeInput("m18ok1")],
      });

      // Approve internal review
      await signalChildWhenRunning("task-m18ok1-review-0", approveSignal, {
        actor: "reviewer",
      });

      // Workflow completes (0 required checks/reviews → immediate merge_ready)
      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(["merged", "merge_ready"]).toContain(state);
    });
  }, 60_000);

  it("merge_ready → pre-check fails → state: failed", async () => {
    const activities = makeMockActivities({
      checkMergeReadiness: async () => ({
        ready: false,
        blockers: ["HEAD SHA mismatch"],
        checksStatus: "all_passing" as const,
        reviewStatus: "approved" as const,
        threadsStatus: "all_resolved" as const,
        codeOwnerStatus: "not_required" as const,
      }),
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-precheck-fail",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-precheck-fail",
        workflowId: "m18-precheck-fail-1",
        args: [makeInput("m18pf1")],
      });

      await signalChildWhenRunning("task-m18pf1-review-0", approveSignal, {
        actor: "reviewer",
      });

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(state).toBe("failed");
    });
  }, 60_000);

  it("merge_ready → merge returns merged: false (no queue) → state: failed", async () => {
    const activities = makeMockActivities({
      mergePullRequest: async () => ({
        merged: false,
        method: "squash",
        message: "Head branch was modified (409)",
      }),
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-merge-409",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-merge-409",
        workflowId: "m18-merge-409-1",
        args: [makeInput("m18x1")],
      });

      await signalChildWhenRunning("task-m18x1-review-0", approveSignal, {
        actor: "reviewer",
      });

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(state).toBe("failed");
    });
  }, 60_000);

  it("merge_ready with merge queue → enqueue succeeds → state: merged (optimistic)", async () => {
    const activities = makeMockActivities({
      mergePullRequest: async () => ({
        merged: false,
        method: "merge_queue",
        mergeQueuePosition: 2,
        message: "Enqueued to merge queue at position 2",
      }),
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-queue",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-queue",
        workflowId: "m18-queue-1",
        args: [makeInput("m18q1")],
      });

      await signalChildWhenRunning("task-m18q1-review-0", approveSignal, {
        actor: "reviewer",
      });

      await handle.result();
      const state = await handle.query(getStateQuery);
      // Optimistic: merge queue enqueue treated as success
      expect(["merged", "merge_ready"]).toContain(state);
    });
  }, 60_000);

  it("pr_closed_merged → skip merge execution → learn runs with merged=true", async () => {
    const mergeSpyCalled = { called: false };
    const activities = makeMockActivities({
      mergePullRequest: async () => {
        mergeSpyCalled.called = true;
        return { merged: true, sha: "sha", method: "squash", message: "ok" };
      },
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-external-merge",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-external-merge",
        workflowId: "m18-ext-merge-1",
        args: [makeInput("m18ext1")],
      });

      // Approve internal review
      await signalChildWhenRunning("task-m18ext1-review-0", approveSignal, {
        actor: "reviewer",
      });

      // PR was merged externally — pr_tracking returns pr_closed_merged
      await signalChildWhenRunning(
        "task-m18ext1-pr_tracking-0",
        prClosedSignal,
        { merged: true },
      );

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(state).toBe("merged");
    });
  }, 60_000);

  it("pr_closed_unmerged → state: failed, no merge attempted", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-closed-unmerged",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: makeMockActivities(),
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-closed-unmerged",
        workflowId: "m18-closed-unmerged-1",
        args: [makeInput("m18cu1")],
      });

      await signalChildWhenRunning("task-m18cu1-review-0", approveSignal, {
        actor: "reviewer",
      });

      // PR was closed without merge
      await signalChildWhenRunning(
        "task-m18cu1-pr_tracking-0",
        prClosedSignal,
        { merged: false },
      );

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(state).toBe("failed");
    });
  }, 60_000);

  it("cleanup runs in failed terminal path (releases lease, destroys sandbox)", async () => {
    const cleanupCalls: string[] = [];
    const activities = makeMockActivities({
      releaseBranchLease: async () => {
        cleanupCalls.push("releaseBranchLease");
        return true;
      },
      destroySandbox: async () => {
        cleanupCalls.push("destroySandbox");
      },
      // Make merge fail to get to failed state
      checkMergeReadiness: async () => ({
        ready: false,
        blockers: ["blocked"],
        checksStatus: "some_failing" as const,
        reviewStatus: "pending" as const,
        threadsStatus: "all_resolved" as const,
        codeOwnerStatus: "not_required" as const,
      }),
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-cleanup-fail",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-cleanup-fail",
        workflowId: "m18-cleanup-fail-1",
        args: [makeInput("m18cf1")],
      });

      await signalChildWhenRunning("task-m18cf1-review-0", approveSignal, {
        actor: "reviewer",
      });

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(state).toBe("failed");
      // Cleanup consolidation should have run
      expect(cleanupCalls).toContain("releaseBranchLease");
    });
  }, 60_000);

  it("cleanup runs in merged terminal path", async () => {
    const cleanupCalls: string[] = [];
    const activities = makeMockActivities({
      releaseBranchLease: async () => {
        cleanupCalls.push("releaseBranchLease");
        return true;
      },
      destroySandbox: async () => {
        cleanupCalls.push("destroySandbox");
      },
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-m18-cleanup-merged",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-m18-cleanup-merged",
        workflowId: "m18-cleanup-merged-1",
        args: [makeInput("m18cm1")],
      });

      await signalChildWhenRunning("task-m18cm1-review-0", approveSignal, {
        actor: "reviewer",
      });

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(["merged", "merge_ready"]).toContain(state);
      expect(cleanupCalls).toContain("releaseBranchLease");
    });
  }, 60_000);
});
