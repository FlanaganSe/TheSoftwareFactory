/**
 * Activity type definitions for proxyActivities<T>() usage.
 *
 * IMPORTANT: This file is imported by workflow code running in a V8 isolate.
 * It must contain ONLY type definitions — no runtime code, no Node.js imports.
 */

import type {
  CapabilitySnapshot,
  PolicyConfig,
  SetupContract,
  TaskState,
  TrustedBaseContext,
} from "@software-factory/core";

// ─── DB Types (serializable representations) ───

export interface TaskRecord {
  readonly id: string;
  readonly state: TaskState;
  readonly objective: string;
  readonly scope: Record<string, unknown> | null;
  readonly constraints: Record<string, unknown> | null;
  readonly budgetCents: string | null;
  readonly repoId: string;
  readonly autonomyLevel: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateTaskInput {
  readonly objective: string;
  readonly repoId: string;
  readonly createdBy: string;
  readonly autonomyLevel?: string;
  readonly scope?: Record<string, unknown> | null;
  readonly constraints?: Record<string, unknown> | null;
  readonly budgetCents?: string | null;
}

export interface AuditEntryInput {
  readonly actor: string;
  readonly actionType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly result: string;
  readonly taskId?: string;
  readonly content?: unknown;
  readonly contentHash: string;
}

// ─── Task Activities ───

export interface TaskActivities {
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  transitionTaskState(
    taskId: string,
    newState: TaskState,
    actor: string,
    auditContent: unknown,
  ): Promise<TaskRecord>;
  getTask(taskId: string): Promise<TaskRecord>;
  listActiveTasks(repoId?: string): Promise<TaskRecord[]>;
}

// ─── Audit Activities ───

export interface AuditActivities {
  insertAuditEntry(entry: AuditEntryInput): Promise<void>;
}

// ─── Safety Activities ───

export interface KillCheckResult {
  readonly killed: boolean;
  readonly scope: "global" | "task" | "none";
}

export interface CostCheckResult {
  readonly allowed: boolean;
  readonly currentCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
}

export interface LeaseResult {
  readonly acquired: boolean;
  readonly existingOwner?: string;
}

export interface CostStatus {
  readonly totalCents: number;
  readonly budgetCents: number;
  readonly percentUsed: number;
  readonly overBudget: boolean;
}

export interface SafetyActivities {
  checkKillSwitch(taskId: string): Promise<KillCheckResult>;
  checkCostBudget(
    taskId: string,
    estimatedCost: number,
  ): Promise<CostCheckResult>;
  acquireBranchLease(
    branch: string,
    taskId: string,
    ttlSeconds: number,
  ): Promise<LeaseResult>;
  releaseBranchLease(branch: string, taskId: string): Promise<boolean>;
  renewBranchLease(
    branch: string,
    taskId: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  recordCost(taskId: string, costCents: number): Promise<CostStatus>;
}

// ─── Sandbox Activities ───

export interface SandboxExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface SandboxInstanceRef {
  readonly containerId: string;
  readonly phase: string;
  readonly labels: Record<string, string>;
}

export interface SandboxProvisionConfig {
  readonly repoPath: string;
  readonly setupContract: SetupContract;
  readonly taskId: string;
  readonly repoSlug: string;
  readonly secrets: SecretBindingsData;
  readonly resourceLimits?: Partial<ResourceLimitsData>;
}

export interface SecretBindingsData {
  readonly setupOnly: Readonly<Record<string, string>>;
  readonly runtime: Readonly<Record<string, string>>;
  readonly perTool: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface ResourceLimitsData {
  readonly memoryBytes: number;
  readonly nanoCpus: number;
  readonly pidsLimit: number;
  readonly tmpSizeMb: number;
  readonly cacheSizeMb: number;
}

export interface SandboxActivities {
  provisionSandbox(config: SandboxProvisionConfig): Promise<SandboxInstanceRef>;
  execInSandbox(
    containerId: string,
    cmd: string[],
    secrets?: Record<string, string>,
  ): Promise<SandboxExecResult>;
  destroySandbox(containerId: string): Promise<void>;
  cleanupOrphans(): Promise<number>;
}

// ─── GitHub Activities ───

export interface FileChangeData {
  readonly path: string;
  readonly content: string;
  readonly mode: "100644" | "100755";
}

export interface GitHubActivities {
  scanRepository(owner: string, repo: string): Promise<CapabilitySnapshot>;
  captureTrustedContext(
    owner: string,
    repo: string,
    defaultBranch: string,
  ): Promise<TrustedBaseContext>;
  createCandidateBranch(
    owner: string,
    repo: string,
    branchName: string,
    baseSha: string,
  ): Promise<{ ref: string; sha: string }>;
  pushChanges(
    owner: string,
    repo: string,
    branchName: string,
    parentSha: string,
    changes: FileChangeData[],
    commitMessage: string,
  ): Promise<{ commitSha: string }>;
  cloneRepo(
    owner: string,
    repo: string,
    targetPath: string,
  ): Promise<{ path: string; headSha: string }>;
}

// ─── LLM Activities ───

export interface AgentStepConfig {
  readonly taskId: string;
  readonly objective: string;
  readonly plan?: string;
  readonly model: string;
  readonly budgetCents: number;
  readonly maxSteps: number;
  readonly wallClockTimeoutMs: number;
}

export interface AgentStepResult {
  readonly success: boolean;
  readonly filesModified: readonly string[];
  readonly toolCallCount: number;
  readonly totalCostCents: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly guardrailTripped?: string;
}

export interface LLMActivities {
  executeAgentStep(config: AgentStepConfig): Promise<AgentStepResult>;
}

// ─── Index Activities ───

export interface RepoMapEntryData {
  readonly filePath: string;
  readonly rank: number;
  readonly keySymbols: readonly string[];
  readonly lineCount: number;
}

export interface IndexResultData {
  readonly indexVersionId: string;
  readonly totalFiles: number;
  readonly indexedFiles: number;
  readonly excludedFiles: number;
  readonly symbolCount: number;
  readonly dependencyCount: number;
  readonly durationMs: number;
  readonly repoMap: readonly RepoMapEntryData[];
}

export interface IndexActivities {
  indexRepositoryActivity(
    repoPath: string,
    commitSha: string,
    repoId: string,
    policies: PolicyConfig[],
  ): Promise<IndexResultData>;
}

// ─── Plan Activities ───

export interface FileContentData {
  readonly path: string;
  readonly content: string;
}

export interface PlanActivities {
  generatePlan(
    objective: string,
    repoMap: RepoMapEntryData[],
    relevantFiles: FileContentData[],
    model: string,
  ): Promise<{ plan: string; estimatedFiles: string[] }>;
}
