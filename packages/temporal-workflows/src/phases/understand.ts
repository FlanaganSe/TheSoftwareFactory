/**
 * Understand phase — code analysis.
 * Runs capability scan, indexes the repository, generates a repo map,
 * and identifies relevant files for the task objective.
 */

import type {
  CapabilitySnapshot,
  TrustedBaseContext,
} from "@software-factory/core";
import { ApplicationFailure, proxyActivities } from "@temporalio/workflow";
import type {
  GitHubActivities,
  IndexActivities,
  SafetyActivities,
  TaskActivities,
} from "../activity-types.js";

const taskActivities = proxyActivities<TaskActivities>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 5 },
});

const safetyActivities = proxyActivities<SafetyActivities>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const githubActivities = proxyActivities<GitHubActivities>({
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
});

const indexActivities = proxyActivities<IndexActivities>({
  startToCloseTimeout: "10m",
  heartbeatTimeout: "2m",
  retry: { maximumAttempts: 2 },
});

export interface UnderstandInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly objective: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly repoPath: string;
  readonly baseSha: string;
}

export interface RepoMapEntryResult {
  readonly filePath: string;
  readonly rank: number;
  readonly keySymbols: readonly string[];
  readonly lineCount: number;
}

export interface UnderstandResult {
  readonly taskId: string;
  readonly capabilitySnapshot: CapabilitySnapshot;
  readonly trustedContext: TrustedBaseContext;
  readonly repoMap: readonly RepoMapEntryResult[];
  readonly relevantFiles: readonly string[];
  readonly indexVersionId: string;
}

export async function understandPhase(
  input: UnderstandInput,
): Promise<UnderstandResult> {
  // Step 1: Check kill switch
  const killCheck = await safetyActivities.checkKillSwitch(input.taskId);
  if (killCheck.killed) {
    throw ApplicationFailure.nonRetryable(
      `Kill switch active: ${killCheck.scope}`,
    );
  }

  // Step 2: Transition task state to in_progress
  await taskActivities.transitionTaskState(
    input.taskId,
    "in_progress",
    "system",
    { phase: "understand", action: "start" },
  );

  // Step 3: Run capability scan (needed to discover defaultBranch)
  const capabilitySnapshot = await githubActivities.scanRepository(
    input.repoOwner,
    input.repoName,
  );

  // Step 4: Capture TrustedBaseContext using the real default branch
  const trustedContext = await githubActivities.captureTrustedContext(
    input.repoOwner,
    input.repoName,
    capabilitySnapshot.defaultBranch,
  );

  // Step 5: Run code indexing (produces repo map as part of result)
  const indexResult = await indexActivities.indexRepositoryActivity(
    input.repoPath,
    input.baseSha,
    input.repoId,
    [],
  );

  // Step 6: Identify relevant files (top-ranked from repo map)
  const TOP_N = 20;
  const sortedMap = [...indexResult.repoMap].sort((a, b) => b.rank - a.rank);
  const relevantFiles = sortedMap.slice(0, TOP_N).map((e) => e.filePath);

  return {
    taskId: input.taskId,
    capabilitySnapshot,
    trustedContext,
    repoMap: indexResult.repoMap,
    relevantFiles,
    indexVersionId: indexResult.indexVersionId,
  };
}
