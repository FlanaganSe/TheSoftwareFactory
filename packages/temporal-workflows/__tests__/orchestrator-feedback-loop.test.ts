import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskWorkflowInput } from "../src/orchestrator.js";
import { getProgressQuery, getStateQuery } from "../src/signals.js";

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
  requiredStatusChecks: [{ context: "ci/test" }],
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
  repoClass: "C" as const,
  supportedByFactory: true,
  unsupportedReasons: [],
  warnings: [],
};

const mockActivities = {
  createTask: async () => ({
    id: "t1",
    state: "created" as const,
    objective: "Add a README",
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
    objective: "Add a README",
    scope: null,
    constraints: null,
    budgetCents: null,
    repoId: "repo-1",
    autonomyLevel: "L2",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  getTask: async () => ({ id: "t1", state: "assigned" }),
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
  cloneRepo: async () => ({ path: "/tmp/factory/t1/repo", headSha: "abc123" }),
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
    plan: "## Plan\n### Step 1\n- **Files:** src/index.ts",
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
    filesModified: [],
    toolCallCount: 0,
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
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
      command: "npx biome check .",
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
    blastRadius: { files: 0, packages: 0 },
    filesChanged: [],
    packagesAffected: [],
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
  // Merge activities (M18)
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
};

function makeInput(
  taskId: string,
  overrides: Partial<TaskWorkflowInput> = {},
): TaskWorkflowInput {
  return {
    taskId,
    repoId: "repo-1",
    repoOwner: "test-org",
    repoName: "test-repo",
    objective: "Add a README",
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
  signalName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const handle = testEnv.client.workflow.getHandle(childId);
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const desc = await handle.describe();
      if (desc.status.name === "RUNNING") {
        await handle.signal(signalName, payload);
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

describe("orchestrator feedback loop (M17)", () => {
  it("pr_tracking returns merge_ready → orchestrator continues to learn", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-fb-merge",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-fb-merge",
        workflowId: "orch-fb-merge-1",
        args: [makeInput("fbmerge1")],
      });

      // First, approve internal review
      await signalChildWhenRunning("task-fbmerge1-review-0", "approve", {
        actor: "reviewer",
      });

      // Then signal PR tracking with approval + check pass → merge_ready
      await signalChildWhenRunning("task-fbmerge1-pr_tracking-0", "pr_review", {
        action: "submitted",
        state: "approved",
        reviewer: "external",
      });
      const trackingHandle = testEnv.client.workflow.getHandle(
        "task-fbmerge1-pr_tracking-0",
      );
      await trackingHandle.signal("check_complete", {
        checkName: "ci/test",
        conclusion: "success",
      });

      await handle.result();
      const state = await handle.query(getStateQuery);
      // M18: merge execution runs after merge_ready, transitions to merged
      expect(["merged", "merge_ready"]).toContain(state);
    });
  }, 60_000);

  it("pr_tracking returns changes_requested → orchestrator loops to implement", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-fb-changes",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-fb-changes",
        workflowId: "orch-fb-changes-1",
        args: [makeInput("fbchanges1")],
      });

      // Approve internal review (iteration 0)
      await signalChildWhenRunning("task-fbchanges1-review-0", "approve", {
        actor: "reviewer",
      });

      // PR tracking: external reviewer requests changes (iteration 0)
      await signalChildWhenRunning(
        "task-fbchanges1-pr_tracking-0",
        "pr_review",
        {
          action: "submitted",
          state: "changes_requested",
          reviewer: "external",
        },
      );

      // After changes_requested, orchestrator loops to implement.
      // phaseIteration increments. The second pr_tracking child is pr_tracking-1.
      // Signal the second PR tracking to complete with merge_ready
      await signalChildWhenRunning(
        "task-fbchanges1-pr_tracking-1",
        "pr_review",
        { action: "submitted", state: "approved", reviewer: "external" },
      );
      const trackingHandle2 = testEnv.client.workflow.getHandle(
        "task-fbchanges1-pr_tracking-1",
      );
      await trackingHandle2.signal("check_complete", {
        checkName: "ci/test",
        conclusion: "success",
      });

      await handle.result();
      const progress = await handle.query(getProgressQuery);
      expect(progress.phaseIteration).toBeGreaterThanOrEqual(1);
    });
  }, 60_000);

  it("max implementation attempts exceeded → orchestrator fails", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-fb-max",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-fb-max",
        workflowId: "orch-fb-max-1",
        args: [
          makeInput("fbmax1", {
            config: {
              reviewTimeoutMs: 14_400_000,
              costBudgetCents: 1000,
              maxImplementationAttempts: 1, // Only 1 attempt allowed
            },
          }),
        ],
      });

      // Approve internal review
      await signalChildWhenRunning("task-fbmax1-review-0", "approve", {
        actor: "reviewer",
      });

      // PR tracking: request changes — but max attempts = 1, so fail
      await signalChildWhenRunning("task-fbmax1-pr_tracking-0", "pr_review", {
        action: "submitted",
        state: "changes_requested",
        reviewer: "external",
      });

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(state).toBe("failed");
    });
  }, 60_000);

  it("pr_tracking returns pr_closed_merged → orchestrator sets merged state", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-fb-merged",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-fb-merged",
        workflowId: "orch-fb-merged-1",
        args: [makeInput("fbmerged1")],
      });

      // Approve internal review
      await signalChildWhenRunning("task-fbmerged1-review-0", "approve", {
        actor: "reviewer",
      });

      // PR was merged externally
      await signalChildWhenRunning(
        "task-fbmerged1-pr_tracking-0",
        "pr_closed",
        { merged: true },
      );

      await handle.result();
      const state = await handle.query(getStateQuery);
      expect(state).toBe("merged");
    });
  }, 60_000);
});
