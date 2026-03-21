/**
 * Implement phase — LLM agent execution.
 * Executes the LLM agent to implement the plan, then pushes changes
 * to a candidate branch via the Git Database API.
 *
 * Implements the L1 autonomy gate: at L0/L1, blocks until human
 * sends an approve signal before any code execution begins.
 */

import type { AutonomyLevel, PolicyConfig } from "@software-factory/core";
import {
  ApplicationFailure,
  condition,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type {
  AgentStepResult,
  FileChangeData,
  GitHubActivities,
  LLMActivities,
  RepoMapEntryData,
  SafetyActivities,
  SandboxActivities,
  SandboxInstanceRef,
  TaskActivities,
} from "../activity-types.js";
import { approveSignal, rejectSignal } from "../signals.js";

const safetyActivities = proxyActivities<SafetyActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const llmActivities = proxyActivities<LLMActivities>({
  startToCloseTimeout: "30m",
  heartbeatTimeout: "5m",
  retry: { maximumAttempts: 1 },
});

const githubActivities = proxyActivities<GitHubActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
});

const sandboxActivities = proxyActivities<SandboxActivities>({
  startToCloseTimeout: "2m",
  retry: { maximumAttempts: 2 },
});

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

export interface ImplementInput {
  readonly taskId: string;
  readonly objective: string;
  readonly plan: string;
  readonly iteration: number;
  readonly sandbox: SandboxInstanceRef;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly branchName: string;
  readonly baseSha: string;
  readonly model: string;
  readonly budgetCents: number;
  readonly autonomyLevel: AutonomyLevel;
  readonly repoMap: readonly RepoMapEntryData[];
  readonly policies: readonly PolicyConfig[];
}

export interface ImplementResult {
  readonly taskId: string;
  readonly iteration: number;
  readonly filesChanged: number;
  readonly candidateBranch: string;
  readonly headSha: string;
  readonly agentResult: AgentStepResult;
}

export async function implementPhase(
  input: ImplementInput,
): Promise<ImplementResult> {
  // Step 1: Check kill switch
  const killCheck = await safetyActivities.checkKillSwitch(input.taskId);
  if (killCheck.killed) {
    throw ApplicationFailure.nonRetryable(
      `Kill switch active: ${killCheck.scope}`,
    );
  }

  // Step 2: AUTONOMY GATE (L0/L1)
  if (input.autonomyLevel === "L0" || input.autonomyLevel === "L1") {
    await taskActivities.transitionTaskState(input.taskId, "paused", "system", {
      phase: "implement",
      action: "awaiting_approval",
      autonomyLevel: input.autonomyLevel,
      plan: input.plan,
    });

    let approved = false;
    let rejected = false;
    let rejectReason = "";

    setHandler(approveSignal, () => {
      approved = true;
    });

    setHandler(rejectSignal, ({ reason }) => {
      rejected = true;
      rejectReason = reason;
    });

    const gateMet = await condition(() => approved || rejected, "4h");
    if (!gateMet) {
      await taskActivities.transitionTaskState(
        input.taskId,
        "failed",
        "system",
        {
          phase: "implement",
          action: "approval_timed_out",
          autonomyLevel: input.autonomyLevel,
        },
      );
      throw ApplicationFailure.nonRetryable(
        "Implementation approval timed out after 4 hours",
      );
    }

    if (rejected) {
      await taskActivities.transitionTaskState(
        input.taskId,
        "failed",
        "system",
        {
          phase: "implement",
          action: "rejected",
          reason: rejectReason,
        },
      );
      throw ApplicationFailure.nonRetryable(
        `Implementation rejected: ${rejectReason}`,
      );
    }

    // Resume from paused
    await taskActivities.transitionTaskState(
      input.taskId,
      "in_progress",
      "system",
      { phase: "implement", action: "approved" },
    );
  }

  // Step 3: Check cost budget
  const costCheck = await safetyActivities.checkCostBudget(input.taskId, 100);
  if (!costCheck.allowed) {
    throw ApplicationFailure.nonRetryable(
      `Cost budget exceeded: ${costCheck.percentUsed.toFixed(0)}% used`,
    );
  }

  // Step 4: Execute LLM agent
  const agentResult = await llmActivities.executeAgentStep({
    taskId: input.taskId,
    objective: input.objective,
    plan: input.plan,
    model: input.model,
    budgetCents: input.budgetCents,
    maxSteps: 50,
    wallClockTimeoutMs: 25 * 60 * 1000, // 25 minutes
    containerId: input.sandbox.containerId,
    repoMap: input.repoMap,
    relevantFiles: [],
    policies: input.policies,
  });

  // If a guardrail tripped, log it. The agent may still have partial progress.
  if (agentResult.guardrailTripped) {
    await taskActivities.transitionTaskState(
      input.taskId,
      "in_progress",
      "system",
      {
        phase: "implement",
        action: "guardrail_tripped",
        guardrail: agentResult.guardrailTripped,
        filesModified: agentResult.filesModified.length,
      },
    );
  }

  // Step 5: After agent completes, collect modified files and push
  let headSha = input.baseSha;

  if (agentResult.filesModified.length > 0) {
    // Create candidate branch if this is the first iteration
    if (input.iteration === 0) {
      await githubActivities.createCandidateBranch(
        input.repoOwner,
        input.repoName,
        input.branchName,
        input.baseSha,
      );
    }

    // Collect changed files from sandbox — both tracked changes and new untracked files
    const diffResult = await sandboxActivities.execInSandbox(
      input.sandbox.containerId,
      ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
    );

    const untrackedResult = await sandboxActivities.execInSandbox(
      input.sandbox.containerId,
      ["git", "ls-files", "--others", "--exclude-standard"],
    );

    const trackedChanges = diffResult.stdout
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const untrackedFiles = untrackedResult.stdout
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const changedPaths = [...new Set([...trackedChanges, ...untrackedFiles])];

    // Read each changed file from sandbox
    const changes: FileChangeData[] = [];
    for (const filePath of changedPaths) {
      const catResult = await sandboxActivities.execInSandbox(
        input.sandbox.containerId,
        ["cat", filePath],
      );
      if (catResult.exitCode === 0) {
        changes.push({
          path: filePath,
          content: catResult.stdout,
          mode: "100644",
        });
      }
    }

    // Push changes via Git Database API
    if (changes.length > 0) {
      const pushResult = await githubActivities.pushChanges(
        input.repoOwner,
        input.repoName,
        input.branchName,
        input.baseSha,
        changes,
        `factory: ${input.objective.slice(0, 72)}`,
      );
      headSha = pushResult.commitSha;
    }
  }

  // Cost is already recorded per-step inside the agent loop via costTracker.recordLLMCost().
  // Do NOT record again here — that would double-count.

  return {
    taskId: input.taskId,
    iteration: input.iteration,
    filesChanged: agentResult.filesModified.length,
    candidateBranch: input.branchName,
    headSha,
    agentResult,
  };
}
