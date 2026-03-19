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

// ─── Shared test data ───

const mockSetupContract = {
  version: "1",
  image: "node:22-slim",
  setup: [],
  maintenance: [],
  secrets: { setup_only: [], runtime: [], per_tool: [] },
  health_check: [],
};

const mockTrustedContext = {
  baseSha: "abc123",
  setupContract: mockSetupContract,
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

const mockTaskRecord = {
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
};

const mockActivities = {
  // DB activities
  createTask: async () => mockTaskRecord,
  transitionTaskState: async (_taskId: string, newState: string) => ({
    ...mockTaskRecord,
    state: newState,
  }),
  getTask: async () => ({ id: "t1", state: "assigned" }),
  listActiveTasks: async () => [],
  insertAuditEntry: async () => {},
  // Safety activities
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
  // GitHub activities
  scanRepository: async () => mockCapabilitySnapshot,
  captureTrustedContext: async () => mockTrustedContext,
  createCandidateBranch: async () => ({
    ref: "refs/heads/factory/t1",
    sha: "abc123",
  }),
  pushChanges: async () => ({ commitSha: "def456" }),
  cloneRepo: async () => ({ path: "/tmp/factory/t1/repo", headSha: "abc123" }),
  // Index activities
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
  // Plan activities
  generatePlan: async () => ({
    plan: "## Plan\n### Step 1\n- **Files:** src/index.ts",
    estimatedFiles: ["src/index.ts"],
  }),
  // Sandbox activities
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
  // LLM activities
  executeAgentStep: async () => ({
    success: true,
    filesModified: [],
    toolCallCount: 0,
    totalCostCents: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  }),
  // Validation activities (M13)
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
  // Evidence activities (M14)
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
  // PR activities (M16)
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
};

/** Create input with unique taskId to prevent child workflow ID collisions. */
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
    autonomyLevel: "L2", // L2 skips implement approval gate; L1 tested in implement-phase.test.ts
    config: {
      reviewTimeoutMs: 14_400_000,
      costBudgetCents: 1000,
      maxImplementationAttempts: 3,
    },
    trustedContext: mockTrustedContext,
    ...overrides,
  };
}

/**
 * Poll for a child workflow to reach RUNNING state, then signal it.
 * Time-skipping is locked during polling (counter=1), so timers don't fire.
 */
async function signalChildWhenRunning(
  childId: string,
  signal:
    | typeof approveSignal
    | typeof rejectSignal
    | typeof changesRequestedSignal,
  payload: Record<string, unknown>,
): Promise<void> {
  const handle = testEnv.client.workflow.getHandle(childId);
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const desc = await handle.describe();
      if (desc.status.name === "RUNNING") {
        await handle.signal(signal, payload as never);
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
        args: [
          makeInput("start1", {
            // Short review timeout: review times out instantly → state="failed"
            config: {
              reviewTimeoutMs: 1,
              costBudgetCents: 1000,
              maxImplementationAttempts: 3,
            },
          }),
        ],
      });

      // With reviewTimeoutMs=1, review times out → workflow completes with "failed"
      await handle.result();

      const progress = await handle.query(getProgressQuery);
      expect(progress.taskId).toBe("start1");
      expect(progress.attemptNumber).toBe(1);
      expect(progress.startedAt).toBeTruthy();
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
      // Use full review timeout so workflow blocks at review
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-kill",
        workflowId: "orch-kill-1",
        args: [makeInput("kill1")],
      });

      // Wait for the review child to start (workflow has reached review phase)
      await signalChildWhenRunning("task-kill1-review-0", approveSignal, {
        actor: "system",
      });

      // Send kill to parent while review is completing
      await handle.signal(killSignal, {
        actor: "operator",
        reason: "emergency",
      });

      // result() unlocks time-skipping — workflow completes
      await handle.result();

      // Kill cleanup sets state to "cancelled" even though review approved
      const state = await handle.query(getStateQuery);
      expect(state).toBe("cancelled");
    });
  }, 30_000);

  it("queries return valid progress", async () => {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-orch-q",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities: mockActivities,
    });

    await worker.runUntil(async () => {
      // Use full review timeout so workflow blocks at review
      const handle = await testEnv.client.workflow.start("taskOrchestrator", {
        taskQueue: "test-orch-q",
        workflowId: "orch-q-1",
        args: [makeInput("query1")],
      });

      // Wait for workflow to reach review (queries are safe while time-skipping locked)
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const phase = await handle.query(getPhaseQuery);
          if (phase === "review") break;
        } catch {
          // Workflow may not be ready for queries yet
        }
      }

      const progress = await handle.query(getProgressQuery);
      expect(progress.taskId).toBe("query1");
      expect(progress.attemptNumber).toBe(1);
      expect(progress.startedAt).toBeTruthy();

      const phase = await handle.query(getPhaseQuery);
      expect(phase).toBe("review");

      // Approve review and complete
      await signalChildWhenRunning("task-query1-review-0", approveSignal, {
        actor: "reviewer",
      });
      await handle.result();
    });
  }, 30_000);

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
        args: [makeInput("approve1")],
      });

      // Signal-before-result: time-skipping is locked (counter=1) so the
      // 4-hour review timeout won't fire during polling.
      await signalChildWhenRunning("task-approve1-review-0", approveSignal, {
        actor: "reviewer",
      });

      // Now call result() — unlocks time-skipping, but condition is satisfied
      await handle.result();
      const finalState = await handle.query(getStateQuery);
      expect(finalState).toBe("merged");
    });
  }, 30_000);

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
        args: [makeInput("reject1")],
      });

      await signalChildWhenRunning("task-reject1-review-0", rejectSignal, {
        actor: "reviewer",
        reason: "not acceptable",
      });

      await handle.result();
      const finalState = await handle.query(getStateQuery);
      expect(finalState).toBe("failed");
    });
  }, 30_000);

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
        args: [makeInput("changes1")],
      });

      // First review: send changes_requested
      await signalChildWhenRunning(
        "task-changes1-review-0",
        changesRequestedSignal,
        { actor: "reviewer", message: "fix tests" },
      );

      // After changes_requested, orchestrator loops back to implement.
      // phaseIteration increments to 1, so the second review child is review-1.
      await new Promise((r) => setTimeout(r, 1000));

      const progress = await handle.query(getProgressQuery);
      expect(progress.phaseIteration).toBeGreaterThanOrEqual(1);

      // Approve the second review to let workflow complete
      await signalChildWhenRunning("task-changes1-review-1", approveSignal, {
        actor: "reviewer",
      });

      await handle.result();
    });
  }, 30_000);
});
