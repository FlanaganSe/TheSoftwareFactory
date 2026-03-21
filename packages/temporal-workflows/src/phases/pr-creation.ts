/**
 * PR creation phase — creates a GitHub PR from the candidate branch,
 * submits factory check runs with validation results, handles auto-merge/merge queue,
 * and persists review state for M17 tracking.
 */

import { patched, proxyActivities } from "@temporalio/workflow";
import type {
  AutoMergeActivities,
  CheckRunActivities,
  CheckRunConfigData,
  CreatePRConfigData,
  PRActivities,
  ReviewStateActivities,
  SafetyActivities,
  TaskActivities,
} from "../activity-types.js";

// ─── Activity Proxies ───

const { checkKillSwitch } = proxyActivities<
  Pick<SafetyActivities, "checkKillSwitch">
>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const { transitionTaskState } = proxyActivities<
  Pick<TaskActivities, "transitionTaskState">
>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

const { createPullRequest } = proxyActivities<
  Pick<PRActivities, "createPullRequest">
>({
  startToCloseTimeout: "60s",
  retry: { maximumAttempts: 3 },
});

const { createFactoryCheckRun, uploadSarif } = proxyActivities<
  Pick<CheckRunActivities, "createFactoryCheckRun" | "uploadSarif">
>({
  startToCloseTimeout: "60s",
  retry: { maximumAttempts: 3 },
});

const { enableAutoMerge, enqueuePullRequest } = proxyActivities<
  Pick<AutoMergeActivities, "enableAutoMerge" | "enqueuePullRequest">
>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 2 },
});

const { createReviewState } = proxyActivities<
  Pick<ReviewStateActivities, "createReviewState">
>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

// ─── Legacy Input/Output (kept for backward compatibility) ───

export interface PrCreationInput {
  readonly taskId: string;
}

export interface PrCreationResult {
  readonly taskId: string;
  readonly prNumber: number;
  readonly prUrl: string;
}

// ─── Full Input/Output (M16) ───

export interface PrCreationFullInput {
  readonly taskId: string;
  readonly repoId: string;
  readonly owner: string;
  readonly repo: string;
  readonly candidateBranch: string;
  readonly baseBranch: string;
  readonly objective: string;
  readonly headSha: string;
  readonly attemptNumber: number;
  readonly evidenceLocator: CreatePRConfigData["evidenceLocator"];
  readonly riskSummary: CreatePRConfigData["riskSummary"];
  readonly validationPassed: boolean;
  readonly validationResult: CreatePRConfigData["validationResult"];
  readonly capabilitySnapshot: CreatePRConfigData["capabilitySnapshot"];
  readonly protectedSurfaceEdits?: readonly string[];
  readonly validatorControlFileEdits?: CreatePRConfigData["validatorControlFileEdits"];
  readonly changedFiles?: CreatePRConfigData["changedFiles"];
  readonly ownersImpacted?: readonly string[];
  readonly evidenceBundleId?: string;
  readonly sarifOutput?: string;
}

export interface PrCreationFullResult {
  readonly taskId: string;
  readonly prNumber: number;
  readonly prUrl: string;
  readonly prNodeId: string;
  readonly checkRunId: number;
  readonly autoMergeEnabled: boolean;
}

// ─── Workflow ───

export async function prCreationPhase(
  input: PrCreationInput | PrCreationFullInput,
): Promise<PrCreationResult | PrCreationFullResult> {
  if (!patched("m16-real-pr-creation")) {
    // Legacy stub path for replay compatibility
    return {
      taskId: input.taskId,
      prNumber: 0,
      prUrl: "stub-pr-url",
    };
  }

  const fullInput = input as PrCreationFullInput;

  // Step 1: Check kill switch
  const killCheck = await checkKillSwitch(fullInput.taskId);
  if (killCheck.killed) {
    throw new Error(`Task ${fullInput.taskId} killed during PR creation`);
  }

  // Step 2: Create PR (idempotent via side-effects ledger)
  const prConfig: CreatePRConfigData = {
    owner: fullInput.owner,
    repo: fullInput.repo,
    candidateBranch: fullInput.candidateBranch,
    baseBranch: fullInput.baseBranch,
    taskId: fullInput.taskId,
    objective: fullInput.objective,
    evidenceLocator: fullInput.evidenceLocator,
    riskSummary: fullInput.riskSummary,
    validationPassed: fullInput.validationPassed,
    headSha: fullInput.headSha,
    capabilitySnapshot: fullInput.capabilitySnapshot,
    attemptNumber: fullInput.attemptNumber,
    validationResult: fullInput.validationResult,
    protectedSurfaceEdits: fullInput.protectedSurfaceEdits,
    validatorControlFileEdits: fullInput.validatorControlFileEdits,
    changedFiles: fullInput.changedFiles,
    ownersImpacted: fullInput.ownersImpacted,
  };

  const prResult = await createPullRequest(prConfig, "");

  // Step 3: Transition task state AFTER PR is confirmed created.
  // Previously this was before createPullRequest — if the API call failed,
  // the DB was stuck at pr_created with no actual PR.
  await transitionTaskState(fullInput.taskId, "pr_created", "system", {
    phase: "pr_creation",
    attemptNumber: fullInput.attemptNumber,
  });

  // Step 4: Create factory check run
  const checkRunConfig: CheckRunConfigData = {
    owner: fullInput.owner,
    repo: fullInput.repo,
    headSha: fullInput.headSha,
    taskId: fullInput.taskId,
    validationPassed: fullInput.validationPassed,
    testResults: fullInput.validationResult.testResults,
    lintResults: fullInput.validationResult.lintResults,
    securityScanResults: fullInput.validationResult.securityScanResults,
    blastRadius: fullInput.validationResult.blastRadius,
    protectedEdits: [],
  };

  const checkRunResult = await createFactoryCheckRun(checkRunConfig);

  // Step 5: Upload SARIF if available (best-effort)
  if (fullInput.sarifOutput) {
    try {
      await uploadSarif(
        fullInput.owner,
        fullInput.repo,
        fullInput.headSha,
        fullInput.sarifOutput,
      );
    } catch {
      // Best-effort — SARIF upload failure doesn't block PR creation
    }
  }

  // Step 6: Auto-merge / merge queue (best-effort)
  let autoMergeEnabled = false;
  const cap = fullInput.capabilitySnapshot;

  if (cap.mergeQueue?.enabled) {
    try {
      await enqueuePullRequest(
        fullInput.owner,
        fullInput.repo,
        prResult.prNodeId,
      );
      autoMergeEnabled = true;
    } catch {
      // Best-effort
    }
  } else if (cap.allowedMergeStrategies.length > 0) {
    try {
      const mergeMethod = cap.allowedMergeStrategies.includes("squash")
        ? "SQUASH"
        : cap.allowedMergeStrategies.includes("merge")
          ? "MERGE"
          : "REBASE";
      await enableAutoMerge(
        fullInput.owner,
        fullInput.repo,
        prResult.prNodeId,
        mergeMethod,
      );
      autoMergeEnabled = true;
    } catch {
      // Best-effort
    }
  }

  // Step 7: Persist review state for M17
  if (fullInput.evidenceBundleId) {
    await createReviewState({
      taskId: fullInput.taskId,
      evidenceBundleId: fullInput.evidenceBundleId,
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
      prNodeId: prResult.prNodeId,
      headSha: fullInput.headSha,
    });
  }

  return {
    taskId: fullInput.taskId,
    prNumber: prResult.prNumber,
    prUrl: prResult.prUrl,
    prNodeId: prResult.prNodeId,
    checkRunId: checkRunResult.checkRunId,
    autoMergeEnabled,
  };
}
