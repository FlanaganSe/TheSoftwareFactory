/**
 * Complete mock activity implementations for E2E tests.
 *
 * These mocks provide realistic return values without hitting external
 * services (GitHub, LLM, Docker). They track state for test assertions.
 */

import type {
  CapabilitySnapshot,
  TaskState,
  TrustedBaseContext,
  ValidatorControlFileEdit,
} from "@software-factory/core";
import type {
  AgentStepConfig,
  AgentStepResult,
  AuditEntryInput,
  BlastRadiusConfigData,
  BlastRadiusResultData,
  CostCheckResult,
  CostStatus,
  CreateTaskInput,
  EvidenceGenerateInput,
  EvidenceGenerateResult,
  FileContentData,
  IndexResultData,
  KillCheckResult,
  LeaseResult,
  LintRunResultData,
  LintRunnerConfigData,
  MergeConfigData,
  MergePrecheckConfigData,
  MergePrecheckData,
  MergeResultData,
  ReconcileResultData,
  ReconcilerConfigData,
  ReconciliationReportData,
  RepoMapEntryData,
  SandboxExecResult,
  SandboxInstanceRef,
  SandboxProvisionConfig,
  SecurityScanConfigData,
  SecurityScanResultData,
  TaskMetricsData,
  TaskRecord,
  TestRunResultData,
  TestRunnerConfigData,
  UpdateReviewStateData,
  ValidatorBoundaryConfigData,
} from "@software-factory/temporal-workflows";

// ─── Local type aliases for types not re-exported from workflow index ───

interface PRResultDataLocal {
  readonly prNumber: number;
  readonly prUrl: string;
  readonly prNodeId: string;
  readonly headSha: string;
}

interface ReviewStateDataLocal {
  readonly id: string;
  readonly taskId: string;
  readonly prNumber: number | null;
  readonly prUrl: string | null;
  readonly prNodeId: string | null;
  readonly headSha: string | null;
  readonly mergeQueueStatus: string | null;
}

// ─── Shared Fixtures ───

export const MOCK_SETUP_CONTRACT = {
  version: "1",
  image: "node:22-slim",
  setup: ["npm ci"] as string[],
  maintenance: [] as string[],
  secrets: {
    setup_only: [] as string[],
    runtime: [] as string[],
    per_tool: [] as Array<{ name: string; tools: string[] }>,
  },
  health_check: [] as string[],
};

export const MOCK_TRUSTED_CONTEXT: TrustedBaseContext = {
  baseSha: "abc123def456",
  setupContract: MOCK_SETUP_CONTRACT,
  policySnapshot: [],
  behavioralControlFiles: {},
  validationCommandSources: ["npm test"],
  capturedAt: new Date().toISOString(),
};

export const MOCK_CAPABILITY_SNAPSHOT: CapabilitySnapshot = {
  repoId: "repo-e2e",
  capturedAt: new Date().toISOString(),
  sourceRevision: "abc123def456",
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
  repoClass: "A" as const,
  supportedByFactory: true,
  unsupportedReasons: [],
  warnings: [],
};

// ─── Mock State Tracker ───

export interface MockState {
  readonly tasksCreated: TaskRecord[];
  readonly stateTransitions: Array<{ taskId: string; newState: TaskState }>;
  readonly auditEntries: AuditEntryInput[];
  readonly branchesLeased: Map<string, string>;
  readonly sandboxesCreated: string[];
  readonly sandboxesDestroyed: string[];
  readonly prsCreated: PRResultDataLocal[];
  readonly mergesExecuted: MergeResultData[];
  readonly costRecorded: Map<string, number>;
  readonly reviewStates: Map<string, ReviewStateDataLocal>;
  readonly metricsRecorded: TaskMetricsData[];
}

export function createMockState(): MockState {
  return {
    tasksCreated: [],
    stateTransitions: [],
    auditEntries: [],
    branchesLeased: new Map(),
    sandboxesCreated: [],
    sandboxesDestroyed: [],
    prsCreated: [],
    mergesExecuted: [],
    costRecorded: new Map(),
    reviewStates: new Map(),
    metricsRecorded: [],
  };
}

// ─── Activity Factory ───

export interface MockActivityOptions {
  /** Track all calls for assertions */
  readonly state: MockState;
  /** If true, kill switch is active globally */
  globalKill?: boolean;
  /** Task IDs with active kill switches */
  killedTaskIds?: Set<string>;
  /** Override cost budget (cents) */
  costBudgetCents?: number;
  /** Override cost per task (for budget tests) */
  costPerStep?: number;
  /** If true, merge readiness check fails */
  mergeNotReady?: boolean;
  /** Custom agent step result */
  agentStepResult?: AgentStepResult;
}

export function createMockActivities(opts: MockActivityOptions) {
  const { state, costBudgetCents = 1000 } = opts;

  let prCounter = 100;
  let checkRunCounter = 1000;
  let taskCounter = 0;

  const activities = {
    // ─── Task Activities ───

    async createTask(input: CreateTaskInput): Promise<TaskRecord> {
      taskCounter++;
      const record: TaskRecord = {
        id: `task-${taskCounter}`,
        state: "created" as const,
        objective: input.objective,
        repoId: input.repoId,
        createdBy: input.createdBy,
        autonomyLevel: input.autonomyLevel ?? "L1",
        scope: input.scope ?? null,
        constraints: input.constraints ?? null,
        budgetCents: input.budgetCents ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.tasksCreated.push(record);
      return record;
    },

    async transitionTaskState(
      taskId: string,
      newState: TaskState,
      _actor: string,
      _auditContent: unknown,
    ): Promise<TaskRecord> {
      state.stateTransitions.push({ taskId, newState });
      return {
        id: taskId,
        state: newState,
        objective: "test",
        repoId: "repo-e2e",
        createdBy: "system",
        autonomyLevel: "L2",
        scope: null,
        constraints: null,
        budgetCents: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    async getTask(taskId: string): Promise<TaskRecord> {
      return {
        id: taskId,
        state: "assigned" as const,
        objective: "test",
        repoId: "repo-e2e",
        createdBy: "system",
        autonomyLevel: "L2",
        scope: null,
        constraints: null,
        budgetCents: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },

    async listActiveTasks(): Promise<TaskRecord[]> {
      return [];
    },

    // ─── Audit Activities ───

    async insertAuditEntry(entry: AuditEntryInput): Promise<void> {
      state.auditEntries.push(entry);
    },

    // ─── Safety Activities ───

    async checkKillSwitch(taskId: string): Promise<KillCheckResult> {
      if (opts.globalKill) {
        return { killed: true, scope: "global" };
      }
      if (opts.killedTaskIds?.has(taskId)) {
        return { killed: true, scope: "task" };
      }
      return { killed: false, scope: "none" };
    },

    async checkCostBudget(
      taskId: string,
      _estimatedCost: number,
    ): Promise<CostCheckResult> {
      const current = state.costRecorded.get(taskId) ?? 0;
      const budget = costBudgetCents;
      return {
        allowed: current < budget,
        currentCents: current,
        budgetCents: budget,
        percentUsed: budget > 0 ? (current / budget) * 100 : 0,
      };
    },

    async acquireBranchLease(
      branch: string,
      taskId: string,
      _ttlSeconds: number,
    ): Promise<LeaseResult> {
      const existing = state.branchesLeased.get(branch);
      if (existing && existing !== taskId) {
        return { acquired: false, existingOwner: existing };
      }
      state.branchesLeased.set(branch, taskId);
      return { acquired: true };
    },

    async releaseBranchLease(branch: string, taskId: string): Promise<boolean> {
      const existing = state.branchesLeased.get(branch);
      if (existing === taskId) {
        state.branchesLeased.delete(branch);
        return true;
      }
      return false;
    },

    async renewBranchLease(
      _branch: string,
      _taskId: string,
      _ttlSeconds: number,
    ): Promise<boolean> {
      return true;
    },

    async recordCost(taskId: string, costCents: number): Promise<CostStatus> {
      const prev = state.costRecorded.get(taskId) ?? 0;
      const total = prev + costCents;
      state.costRecorded.set(taskId, total);
      return {
        totalCents: total,
        budgetCents: costBudgetCents,
        percentUsed: costBudgetCents > 0 ? (total / costBudgetCents) * 100 : 0,
        overBudget: total > costBudgetCents,
      };
    },

    // ─── GitHub Activities ───

    async scanRepository(
      _owner: string,
      _repo: string,
    ): Promise<CapabilitySnapshot> {
      return MOCK_CAPABILITY_SNAPSHOT;
    },

    async captureTrustedContext(
      _owner: string,
      _repo: string,
      _defaultBranch: string,
    ): Promise<TrustedBaseContext> {
      return MOCK_TRUSTED_CONTEXT;
    },

    async createCandidateBranch(
      _owner: string,
      _repo: string,
      branchName: string,
      baseSha: string,
    ): Promise<{ ref: string; sha: string }> {
      return { ref: `refs/heads/${branchName}`, sha: baseSha };
    },

    async pushChanges(
      _owner: string,
      _repo: string,
      _branchName: string,
      _parentSha: string,
      _changes: unknown[],
      _commitMessage: string,
    ): Promise<{ commitSha: string }> {
      return { commitSha: "newcommit123" };
    },

    async cloneRepo(
      _owner: string,
      _repo: string,
      targetPath: string,
    ): Promise<{ path: string; headSha: string }> {
      return { path: targetPath, headSha: "abc123def456" };
    },

    // ─── Index Activities ───

    async indexRepositoryActivity(
      _repoPath: string,
      _commitSha: string,
      _repoId: string,
      _policies: unknown[],
    ): Promise<IndexResultData> {
      return {
        indexVersionId: "idx-e2e-1",
        totalFiles: 10,
        indexedFiles: 8,
        excludedFiles: 2,
        symbolCount: 50,
        dependencyCount: 20,
        durationMs: 100,
        repoMap: [
          {
            filePath: "src/index.ts",
            rank: 1.0,
            keySymbols: ["main"],
            lineCount: 50,
          },
        ],
      };
    },

    // ─── Plan Activities ───

    async generatePlan(
      _objective: string,
      _repoMap: RepoMapEntryData[],
      _relevantFiles: FileContentData[],
      _model: string,
    ): Promise<{ plan: string; estimatedFiles: string[] }> {
      return {
        plan: "## Plan\n### Step 1\n- Modify src/index.ts",
        estimatedFiles: ["src/index.ts"],
      };
    },

    // ─── Sandbox Activities ───

    async provisionSandbox(
      config: SandboxProvisionConfig,
    ): Promise<SandboxInstanceRef> {
      const containerId = `container-${config.taskId}`;
      state.sandboxesCreated.push(containerId);
      return {
        containerId,
        phase: "execution",
        labels: { "com.factory.task-id": config.taskId },
      };
    },

    async execInSandbox(
      _containerId: string,
      _cmd: string[],
      _secrets?: Record<string, string>,
    ): Promise<SandboxExecResult> {
      return { exitCode: 0, stdout: "ok", stderr: "", durationMs: 50 };
    },

    async destroySandbox(containerId: string): Promise<void> {
      state.sandboxesDestroyed.push(containerId);
    },

    async cleanupOrphans(): Promise<number> {
      return 0;
    },

    // ─── LLM Activities ───

    async executeAgentStep(config: AgentStepConfig): Promise<AgentStepResult> {
      if (opts.agentStepResult) {
        return opts.agentStepResult;
      }
      const cost = opts.costPerStep ?? 50;
      const prev = state.costRecorded.get(config.taskId) ?? 0;
      state.costRecorded.set(config.taskId, prev + cost);
      return {
        success: true,
        filesModified: ["src/index.ts"],
        toolCallCount: 3,
        totalCostCents: cost,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
      };
    },

    // ─── Validation Activities ───

    async getChangedFiles(
      _containerId: string,
      _baseSha: string,
    ): Promise<string[]> {
      return ["src/index.ts"];
    },

    async runTests(_config: TestRunnerConfigData): Promise<TestRunResultData> {
      return {
        testResults: {
          passed: 5,
          failed: 0,
          skipped: 0,
          newTests: [],
          modifiedTests: [],
          deletedTests: [],
          details: [],
        },
        exitCode: 0,
        commandRecord: { command: "npm test", exitCode: 0, durationMs: 200 },
      };
    },

    async runLinter(_config: LintRunnerConfigData): Promise<LintRunResultData> {
      return {
        lintResults: { errorCount: 0, warningCount: 0, details: [] },
        exitCode: 0,
        commandRecord: {
          command: "biome check .",
          exitCode: 0,
          durationMs: 100,
        },
      };
    },

    async runSecurityScan(
      _config: SecurityScanConfigData,
    ): Promise<SecurityScanResultData> {
      return {
        securityScanResults: {
          vulnerabilities: [],
          totalFindings: 0,
          criticalCount: 0,
          highCount: 0,
        },
        commandsRun: [],
      };
    },

    async computeBlastRadius(
      _config: BlastRadiusConfigData,
    ): Promise<BlastRadiusResultData> {
      return {
        blastRadius: { files: 1, packages: 1 },
        filesChanged: ["src/index.ts"],
        packagesAffected: ["@test/pkg"],
        protectedSurfaceEdits: [],
        migrationImpact: {
          hasMigrations: false,
          migrationFiles: [],
          schemaChanges: [],
        },
        revertabilityClass: "clean_revert",
      };
    },

    async checkValidatorBoundary(
      _config: ValidatorBoundaryConfigData,
    ): Promise<ValidatorControlFileEdit[]> {
      return [];
    },

    // ─── Evidence Activities ───

    async generateAndPersistEvidence(
      input: EvidenceGenerateInput,
    ): Promise<EvidenceGenerateResult> {
      const bundleId = `bundle-${input.taskId}-${input.attemptNumber}`;
      return {
        bundleId,
        locator: {
          taskId: input.taskId,
          attemptNumber: input.attemptNumber,
          bundleId,
          artifactPrefix: `evidence/${input.taskId}/${input.attemptNumber}/`,
          evidenceJsonKey: `evidence/${input.taskId}/${input.attemptNumber}/evidence.json`,
          manifestKey: `evidence/${input.taskId}/${input.attemptNumber}/manifest.json`,
          diffPatchKey: `evidence/${input.taskId}/${input.attemptNumber}/diff.patch`,
          createdAt: new Date().toISOString(),
        },
        riskSummary: {
          hardBlockers: [],
          softConcerns: [],
          humanJudgmentRequired: [],
          informational: [],
        },
        passed: true,
      };
    },

    // ─── PR Activities ───

    async createPullRequest(
      config: {
        owner: string;
        repo: string;
        headSha: string;
        [k: string]: unknown;
      },
      _apiUrl: string,
    ): Promise<PRResultDataLocal> {
      prCounter++;
      const result: PRResultDataLocal = {
        prNumber: prCounter,
        prUrl: `https://github.com/${config.owner}/${config.repo}/pull/${prCounter}`,
        prNodeId: `PR_node_${prCounter}`,
        headSha: config.headSha,
      };
      state.prsCreated.push(result);
      return result;
    },

    async updatePullRequest(
      _owner: string,
      _repo: string,
      _prNumber: number,
      _updates: unknown,
    ): Promise<void> {},

    // ─── Check Run Activities ───

    async createFactoryCheckRun(
      _config: unknown,
    ): Promise<{ checkRunId: number; checkRunUrl: string }> {
      checkRunCounter++;
      return {
        checkRunId: checkRunCounter,
        checkRunUrl: `https://github.com/test/check/${checkRunCounter}`,
      };
    },

    async updateCheckRun(
      _owner: string,
      _repo: string,
      _checkRunId: number,
      _updates: unknown,
    ): Promise<void> {},

    async uploadSarif(
      _owner: string,
      _repo: string,
      _commitSha: string,
      _sarifContent: string,
    ): Promise<void> {},

    // ─── Auto-Merge Activities ───

    async enableAutoMerge(
      _owner: string,
      _repo: string,
      _prNodeId: string,
      _mergeMethod: string,
    ): Promise<void> {},

    async enqueuePullRequest(
      _owner: string,
      _repo: string,
      _prNodeId: string,
    ): Promise<void> {},

    // ─── Review State Activities ───

    async createReviewState(input: {
      taskId: string;
      prNumber: number;
      prUrl: string;
      prNodeId: string;
      headSha: string;
      [k: string]: unknown;
    }): Promise<void> {
      state.reviewStates.set(input.taskId, {
        id: `rs-${input.taskId}`,
        taskId: input.taskId,
        prNumber: input.prNumber,
        prUrl: input.prUrl,
        prNodeId: input.prNodeId,
        headSha: input.headSha,
        mergeQueueStatus: null,
      });
    },

    async getReviewState(taskId: string): Promise<ReviewStateDataLocal | null> {
      return state.reviewStates.get(taskId) ?? null;
    },

    async updateReviewState(
      taskId: string,
      updates: UpdateReviewStateData,
    ): Promise<void> {
      const existing = state.reviewStates.get(taskId);
      if (existing) {
        state.reviewStates.set(taskId, { ...existing, ...updates });
      }
    },

    // ─── Review Tracker Activities ───

    async reconcilePRState(
      _config: ReconcilerConfigData,
    ): Promise<ReconcileResultData> {
      return {
        prState: "open" as const,
        reviewDecision: "APPROVED",
        unresolvedThreads: 0,
        checks: [],
        staleReviews: false,
        headSha: "abc123def456",
      };
    },

    // ─── Merge Activities ───

    async checkMergeReadiness(
      _config: MergePrecheckConfigData,
    ): Promise<MergePrecheckData> {
      if (opts.mergeNotReady) {
        return {
          ready: false,
          blockers: ["checks_pending"],
          checksStatus: "pending",
          reviewStatus: "pending",
          threadsStatus: "all_resolved",
          codeOwnerStatus: "not_required",
        };
      }
      return {
        ready: true,
        blockers: [],
        checksStatus: "all_passing",
        reviewStatus: "approved",
        threadsStatus: "all_resolved",
        codeOwnerStatus: "not_required",
      };
    },

    async mergePullRequest(_config: MergeConfigData): Promise<MergeResultData> {
      const result: MergeResultData = {
        merged: true,
        sha: "mergecommit789",
        method: "squash",
        message: "Merged successfully",
      };
      state.mergesExecuted.push(result);
      return result;
    },

    async deleteBranch(
      _owner: string,
      _repo: string,
      _branch: string,
    ): Promise<void> {},

    // ─── Learn Activities ───

    async recordTaskMetrics(
      _taskId: string,
      metrics: TaskMetricsData,
    ): Promise<void> {
      state.metricsRecorded.push(metrics);
    },

    // ─── Broad Reconciler Activities ───

    async reconcileAllResources(): Promise<ReconciliationReportData> {
      return {
        activePRsChecked: 0,
        staleDetected: 0,
        driftDetected: 0,
        signalsSent: 0,
        errors: [],
        durationMs: 10,
      };
    },

    async reconcileActivePRs(): Promise<Partial<ReconciliationReportData>> {
      return { activePRsChecked: 0 };
    },
  };

  return activities;
}
