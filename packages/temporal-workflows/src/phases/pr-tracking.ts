/**
 * PR tracking phase — long-lived child workflow that waits for GitHub
 * events (reviews, checks, merge queue) via signals, tracks PR state,
 * and periodically reconciles with GitHub as a safety net for missed webhooks.
 */

import {
  condition,
  defineQuery,
  patched,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type {
  ReconcileResultData,
  ReviewStateActivities,
  ReviewTrackerActivities,
} from "../activity-types.js";
import {
  checkCompleteSignal,
  killSignal,
  mergeQueueUpdateSignal,
  prClosedSignal,
  prReviewSignal,
} from "../signals.js";

// ─── Activity Proxies ───

const reconcileActivities = proxyActivities<ReviewTrackerActivities>({
  startToCloseTimeout: "60s",
  retry: { maximumAttempts: 3 },
});

const reviewStateActivities = proxyActivities<
  Pick<ReviewStateActivities, "updateReviewState">
>({
  startToCloseTimeout: "10s",
  retry: { maximumAttempts: 3 },
});

// ─── Types ───

export interface PrTrackingInput {
  readonly taskId: string;
  readonly repoId?: string;
  readonly owner?: string;
  readonly repo?: string;
  readonly prNumber: number;
  readonly prNodeId?: string;
  readonly headSha?: string;
  readonly baseBranch?: string;
  readonly requiredChecks?: readonly string[];
  readonly requiredReviewCount?: number;
  readonly requiresCodeOwnerReview?: boolean;
}

export type PrTrackingOutcome =
  | "merge_ready"
  | "changes_requested"
  | "pr_closed_merged"
  | "pr_closed_unmerged"
  | "timed_out";

export interface PRStateSnapshot {
  readonly approvedBy: readonly string[];
  readonly changesRequestedBy: readonly string[];
  readonly commentedBy: readonly string[];
  readonly reviewDecision: string;
  readonly staleReviews: boolean;
  readonly checksCompleted: ReadonlyMap<string, string>;
  readonly allRequiredChecksPassing: boolean;
  readonly unresolvedThreads: number;
  readonly mergeQueueStatus: string;
  readonly isMergeReady: boolean;
  readonly lastUpdated: string;
}

export interface PrTrackingResult {
  readonly taskId: string;
  readonly outcome: PrTrackingOutcome;
  readonly prState: PRStateSnapshot;
  readonly feedbackMessage?: string;
  readonly reviewer?: string;
}

// Query for external inspection
export const getPRStateQuery = defineQuery<PRStateSnapshot>("getPRState");

// ─── Workflow ───

export async function prTrackingPhase(
  input: PrTrackingInput,
): Promise<PrTrackingResult> {
  if (!patched("m17-real-pr-tracking")) {
    // Legacy stub path for replay compatibility
    return {
      taskId: input.taskId,
      outcome: "merge_ready",
      prState: createEmptyState(),
    };
  }

  const requiredChecks = input.requiredChecks ?? [];
  const requiredReviewCount = input.requiredReviewCount ?? 0;
  const requiresCodeOwnerReview = input.requiresCodeOwnerReview ?? false;

  // ─── Mutable workflow state ───
  let approvedBy: string[] = [];
  let changesRequestedBy: string[] = [];
  let commentedBy: string[] = [];
  let reviewDecision = "REVIEW_REQUIRED";
  let staleReviews = false;
  const checksCompleted = new Map<string, string>();
  let allRequiredChecksPassing = false;
  let unresolvedThreads = 0;
  let mergeQueueStatus = "none";
  let isMergeReady = false;
  let lastUpdated = new Date().toISOString();

  let prClosed: { merged: boolean } | null = null;
  let feedbackReceived: {
    reviewer: string;
    action: string;
    message?: string;
  } | null = null;
  let killed = false;

  // ─── Helper: evaluate merge readiness ───
  function evaluateMergeReadiness(): void {
    const reviewsMet =
      approvedBy.length >= requiredReviewCount &&
      changesRequestedBy.length === 0;

    const codeOwnerMet = !requiresCodeOwnerReview || approvedBy.length > 0;

    const checksMet =
      requiredChecks.length === 0 ||
      requiredChecks.every((check) => checksCompleted.get(check) === "success");

    const threadsMet = unresolvedThreads === 0;

    allRequiredChecksPassing = checksMet;
    isMergeReady =
      reviewsMet && codeOwnerMet && checksMet && threadsMet && !staleReviews;
    lastUpdated = new Date().toISOString();
  }

  function snapshotState(): PRStateSnapshot {
    return {
      approvedBy: [...approvedBy],
      changesRequestedBy: [...changesRequestedBy],
      commentedBy: [...commentedBy],
      reviewDecision,
      staleReviews,
      checksCompleted: new Map(checksCompleted),
      allRequiredChecksPassing,
      unresolvedThreads,
      mergeQueueStatus,
      isMergeReady,
      lastUpdated,
    };
  }

  function applyReconcileResult(reconciled: ReconcileResultData): void {
    unresolvedThreads = reconciled.unresolvedThreads;
    staleReviews = reconciled.staleReviews;
    reviewDecision = reconciled.reviewDecision;

    // Update checks from reconciliation
    for (const check of reconciled.checks) {
      checksCompleted.set(check.name, check.conclusion);
    }

    // Handle PR closed/merged during reconciliation
    if (reconciled.prState === "merged") {
      prClosed = { merged: true };
    } else if (reconciled.prState === "closed") {
      prClosed = { merged: false };
    }

    evaluateMergeReadiness();
    lastUpdated = new Date().toISOString();
  }

  // ─── Signal Handlers ───

  setHandler(prReviewSignal, ({ state, reviewer }) => {
    if (state === "approved") {
      approvedBy = [...new Set([...approvedBy, reviewer])];
      changesRequestedBy = changesRequestedBy.filter((r) => r !== reviewer);
    } else if (state === "changes_requested") {
      changesRequestedBy = [...new Set([...changesRequestedBy, reviewer])];
      approvedBy = approvedBy.filter((r) => r !== reviewer);
      feedbackReceived = { reviewer, action: "changes_requested" };
    } else if (state === "commented") {
      commentedBy = [...new Set([...commentedBy, reviewer])];
    } else if (state === "dismissed") {
      approvedBy = approvedBy.filter((r) => r !== reviewer);
    }
    evaluateMergeReadiness();
  });

  setHandler(checkCompleteSignal, ({ checkName, conclusion }) => {
    checksCompleted.set(checkName, conclusion);
    evaluateMergeReadiness();
  });

  setHandler(prClosedSignal, ({ merged }) => {
    prClosed = { merged };
  });

  setHandler(mergeQueueUpdateSignal, ({ status }) => {
    mergeQueueStatus = status;
    lastUpdated = new Date().toISOString();
  });

  setHandler(killSignal, () => {
    killed = true;
  });

  // ─── Query Handler ───
  setHandler(getPRStateQuery, () => snapshotState());

  // ─── Outcome evaluation (extracted to avoid TS narrowing issues) ───
  function checkOutcome(): PrTrackingResult | null {
    if (killed) {
      return {
        taskId: input.taskId,
        outcome: "timed_out",
        prState: snapshotState(),
      };
    }
    if (prClosed?.merged) {
      return {
        taskId: input.taskId,
        outcome: "pr_closed_merged",
        prState: snapshotState(),
      };
    }
    if (prClosed !== null && !prClosed.merged) {
      return {
        taskId: input.taskId,
        outcome: "pr_closed_unmerged",
        prState: snapshotState(),
      };
    }
    if (
      feedbackReceived !== null &&
      feedbackReceived.action === "changes_requested"
    ) {
      return {
        taskId: input.taskId,
        outcome: "changes_requested",
        prState: snapshotState(),
        reviewer: feedbackReceived.reviewer,
        feedbackMessage: feedbackReceived.message,
      };
    }
    if (isMergeReady) {
      return {
        taskId: input.taskId,
        outcome: "merge_ready",
        prState: snapshotState(),
      };
    }
    return null;
  }

  // ─── Main tracking loop with reconciliation ───

  const trackingTimeoutMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  const reconcilerIntervalMs = 5 * 60 * 1000; // 5 minutes
  const startTime = Date.now();

  for (;;) {
    const elapsed = Date.now() - startTime;
    if (elapsed >= trackingTimeoutMs) {
      return {
        taskId: input.taskId,
        outcome: "timed_out",
        prState: snapshotState(),
      };
    }

    const remainingTimeout = Math.min(
      reconcilerIntervalMs,
      trackingTimeoutMs - elapsed,
    );

    const signalReceived = await condition(
      () =>
        prClosed !== null ||
        feedbackReceived !== null ||
        isMergeReady ||
        killed,
      remainingTimeout,
    );

    // Check for terminal outcome (from signal or prior state)
    const outcome = checkOutcome();
    if (outcome) return outcome;

    // No signal in interval — reconcile from GitHub
    if (!signalReceived && input.owner && input.repo && input.prNumber > 0) {
      try {
        const reconciled = await reconcileActivities.reconcilePRState({
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
        });

        applyReconcileResult(reconciled);

        await reviewStateActivities.updateReviewState(input.taskId, {
          unresolvedThreads,
          staleReviews,
          mergeQueueStatus,
          lastGithubSync: new Date().toISOString(),
        });
      } catch {
        // Reconciliation failure is non-fatal — retry on next interval
      }

      // Re-check after reconciliation
      const postReconcileOutcome = checkOutcome();
      if (postReconcileOutcome) return postReconcileOutcome;
    }
  }
}

function createEmptyState(): PRStateSnapshot {
  return {
    approvedBy: [],
    changesRequestedBy: [],
    commentedBy: [],
    reviewDecision: "REVIEW_REQUIRED",
    staleReviews: false,
    checksCompleted: new Map(),
    allRequiredChecksPassing: false,
    unresolvedThreads: 0,
    mergeQueueStatus: "none",
    isMergeReady: false,
    lastUpdated: new Date().toISOString(),
  };
}
