/**
 * Activity type definitions for proxyActivities<T>() usage.
 *
 * IMPORTANT: This file is imported by workflow code running in a V8 isolate.
 * It must contain ONLY type definitions — no runtime code, no Node.js imports.
 */

import type { TaskState } from "@software-factory/core";

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

export interface SandboxActivities {
  provisionSandbox(config: unknown): Promise<SandboxInstanceRef>;
  execInSandbox(
    containerId: string,
    cmd: string[],
    secrets?: Record<string, string>,
  ): Promise<SandboxExecResult>;
  destroySandbox(containerId: string): Promise<void>;
  cleanupOrphans(): Promise<number>;
}

export interface GitHubActivities {
  scanRepository(owner: string, repo: string): Promise<unknown>;
}

export interface LLMActivities {
  executeAgent(config: unknown): Promise<unknown>;
}

export interface IndexActivities {
  indexRepository(config: unknown): Promise<unknown>;
}
