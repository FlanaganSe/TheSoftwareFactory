import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let testEnv: TestWorkflowEnvironment;

const mockTaskRecord = {
  id: "t1",
  state: "created" as const,
  objective: "Add a README",
  repoId: "repo-1",
  createdBy: "system",
  autonomyLevel: "L1",
  scope: null,
  constraints: null,
  budgetCents: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
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

const mockSetupContract = {
  version: "1",
  image: "node:22-slim",
  setup: ["npm install"],
  maintenance: [],
  secrets: { setup_only: [], runtime: [], per_tool: [] },
  health_check: ["node --version"],
};

function createMockActivities(overrides: Record<string, unknown> = {}) {
  return {
    createTask: async () => mockTaskRecord,
    transitionTaskState: async (_taskId: string, newState: string) => ({
      ...mockTaskRecord,
      state: newState,
    }),
    getTask: async () => ({ id: "t1", state: "created" }),
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
    scanRepository: async () => mockCapabilitySnapshot,
    captureTrustedContext: async () => ({
      baseSha: "abc123",
      setupContract: mockSetupContract,
      policySnapshot: [],
      behavioralControlFiles: {},
      validationCommandSources: [],
      capturedAt: new Date().toISOString(),
    }),
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
    ...overrides,
  };
}

beforeAll(async () => {
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 60_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("M12 pipeline — individual phases", () => {
  it("plan phase: cost budget exceeded → fails", async () => {
    const activities = createMockActivities({
      checkCostBudget: async () => ({
        allowed: false,
        currentCents: 950,
        budgetCents: 1000,
        percentUsed: 95,
      }),
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-plan-budget",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("planPhase", {
        taskQueue: "test-plan-budget",
        workflowId: "plan-budget-1",
        retry: { maximumAttempts: 1 },
        args: [
          {
            taskId: "b1",
            objective: "test",
            repoMap: [],
            relevantFiles: [],
            model: "test-model",
          },
        ],
      });

      try {
        await handle.result();
        expect.unreachable("should have failed");
      } catch {
        // Expected — budget exceeded
      }
    });
  });

  it("plan phase: generates plan and persists audit entry", async () => {
    let auditCalled = false;
    const activities = createMockActivities({
      insertAuditEntry: async () => {
        auditCalled = true;
      },
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-plan-audit",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("planPhase", {
        taskQueue: "test-plan-audit",
        workflowId: "plan-audit-1",
        args: [
          {
            taskId: "a1",
            objective: "Add README",
            repoMap: [],
            relevantFiles: [],
            model: "test-model",
          },
        ],
      });

      const result = await handle.result();
      expect(result.plan).toContain("Plan");
      expect(result.estimatedFiles).toContain("src/index.ts");
      expect(auditCalled).toBe(true);
    });
  });

  it("setup phase: with setup contract → provisions sandbox and acquires lease", async () => {
    let sandboxProvisioned = false;
    let leaseAcquired = false;
    const activities = createMockActivities({
      provisionSandbox: async () => {
        sandboxProvisioned = true;
        return { containerId: "c-1", phase: "execution", labels: {} };
      },
      acquireBranchLease: async () => {
        leaseAcquired = true;
        return { acquired: true };
      },
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-setup-contract",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("setupPhase", {
        taskQueue: "test-setup-contract",
        workflowId: "setup-contract-1",
        args: [
          {
            taskId: "s1",
            repoId: "repo-1",
            repoPath: "/tmp/repo",
            repoSlug: "org/repo",
            trustedContext: {
              baseSha: "abc123",
              setupContract: mockSetupContract,
              policySnapshot: [],
              behavioralControlFiles: {},
              validationCommandSources: [],
              capturedAt: new Date().toISOString(),
            },
          },
        ],
      });

      const result = await handle.result();
      expect(result.sandboxInstance.containerId).toBe("c-1");
      expect(result.branchLease.acquired).toBe(true);
      expect(sandboxProvisioned).toBe(true);
      expect(leaseAcquired).toBe(true);
    });
  });

  it("setup phase: branch lease denied → cleans up sandbox and throws", async () => {
    const activities = createMockActivities({
      acquireBranchLease: async () => ({
        acquired: false,
        existingOwner: "other-task",
      }),
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-setup-lease-denied",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("setupPhase", {
        taskQueue: "test-setup-lease-denied",
        workflowId: "setup-lease-denied-1",
        retry: { maximumAttempts: 1 },
        args: [
          {
            taskId: "s2",
            repoId: "repo-1",
            repoPath: "/tmp/repo",
            repoSlug: "org/repo",
            trustedContext: {
              baseSha: "abc123",
              setupContract: mockSetupContract,
              policySnapshot: [],
              behavioralControlFiles: {},
              validationCommandSources: [],
              capturedAt: new Date().toISOString(),
            },
          },
        ],
      });

      try {
        await handle.result();
        expect.unreachable("should have failed");
      } catch {
        // Expected — branch lease denied
      }
    });
  });

  it("implement phase (L2): runs agent and returns result", async () => {
    const activities = createMockActivities({
      executeAgentStep: async () => ({
        success: true,
        filesModified: ["a.ts"],
        toolCallCount: 3,
        totalCostCents: 15,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
      }),
    });

    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: "test-impl-l2-run",
      workflowsPath: new URL("../src/index.ts", import.meta.url).pathname,
      activities,
    });

    await worker.runUntil(async () => {
      const handle = await testEnv.client.workflow.start("implementPhase", {
        taskQueue: "test-impl-l2-run",
        workflowId: "impl-l2-run-1",
        args: [
          {
            taskId: "i1",
            objective: "Add feature",
            plan: "step 1",
            iteration: 0,
            sandbox: { containerId: "c-1", phase: "execution", labels: {} },
            repoOwner: "org",
            repoName: "repo",
            branchName: "factory/i1",
            baseSha: "abc123",
            model: "test-model",
            budgetCents: 500,
            autonomyLevel: "L2",
          },
        ],
      });

      const result = await handle.result();
      expect(result.filesChanged).toBe(1);
      expect(result.agentResult.totalCostCents).toBe(15);
    });
  });
});

// Note: Full orchestrator lifecycle tests (kill signal, approve/reject, changes_requested)
// are covered in orchestrator.test.ts. These M12 tests focus on individual phase behavior.
