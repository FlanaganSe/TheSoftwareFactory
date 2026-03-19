/**
 * Webhook-to-Temporal signal dispatcher.
 * Routes incoming GitHub webhook events to the appropriate workflow signal.
 *
 * Signal names must match those in packages/temporal-workflows/src/signals.ts.
 * We use string names (not imported signal definitions) because the API package
 * does not depend on the workflow package — same pattern as routes/tasks.ts.
 */

import type { DbInstance } from "@software-factory/db";
import { reviewStateRepo } from "@software-factory/db";
import type { Client } from "@temporalio/client";

// Signal names matching temporal-workflows/src/signals.ts
const SIGNAL_PR_REVIEW = "pr_review";
const SIGNAL_CHECK_COMPLETE = "check_complete";
const SIGNAL_MERGE_QUEUE_UPDATE = "merge_queue_update";
const SIGNAL_PR_CLOSED = "pr_closed";

export interface DispatchResult {
  readonly dispatched: boolean;
  readonly workflowId?: string;
  readonly signalName?: string;
}

interface PullRequestPayload {
  readonly number: number;
  readonly merged?: boolean;
}

interface ReviewPayload {
  readonly state: string;
  readonly user: { readonly login: string };
}

interface CheckSuitePayload {
  readonly app: { readonly name: string };
  readonly conclusion: string | null;
  readonly pull_requests: readonly { readonly number: number }[];
}

interface CheckRunPayload {
  readonly name: string;
  readonly conclusion: string | null;
  readonly pull_requests: readonly { readonly number: number }[];
}

interface MergeGroupPayload {
  readonly head_ref?: string;
}

function extractRepoFullName(payload: Record<string, unknown>): string | null {
  const repo = payload.repository as { full_name?: string } | undefined;
  return repo?.full_name ?? null;
}

function extractPrNumber(
  event: string,
  payload: Record<string, unknown>,
): number | null {
  if (event === "pull_request" || event === "pull_request_review") {
    const pr = payload.pull_request as PullRequestPayload | undefined;
    return pr?.number ?? null;
  }
  if (event === "check_suite") {
    const suite = payload.check_suite as CheckSuitePayload | undefined;
    return suite?.pull_requests?.[0]?.number ?? null;
  }
  if (event === "check_run") {
    const run = payload.check_run as CheckRunPayload | undefined;
    return run?.pull_requests?.[0]?.number ?? null;
  }
  return null;
}

async function resolveWorkflowId(
  db: DbInstance,
  prNumber: number,
  repoFullName: string,
): Promise<string | null> {
  const result = await reviewStateRepo.getReviewStateByPrNumber(
    db,
    prNumber,
    repoFullName,
  );
  if (result.isErr() || !result.value) return null;
  return `task-${result.value.taskId}`;
}

export async function dispatchWebhookToWorkflow(
  client: Client,
  db: DbInstance,
  event: string,
  action: string | null,
  payload: Record<string, unknown>,
): Promise<DispatchResult> {
  const repoFullName = extractRepoFullName(payload);
  if (!repoFullName) return { dispatched: false };

  if (event === "merge_group") {
    return dispatchMergeGroupEvent(client, db, action, payload, repoFullName);
  }

  const prNumber = extractPrNumber(event, payload);
  if (!prNumber) return { dispatched: false };

  const workflowId = await resolveWorkflowId(db, prNumber, repoFullName);
  if (!workflowId) return { dispatched: false };

  try {
    const handle = client.workflow.getHandle(workflowId);

    if (event === "pull_request" && action === "closed") {
      const pr = payload.pull_request as PullRequestPayload;
      const merged = pr?.merged ?? false;
      await handle.signal(SIGNAL_PR_CLOSED, { merged });
      return { dispatched: true, workflowId, signalName: SIGNAL_PR_CLOSED };
    }

    if (event === "pull_request" && action === "synchronize") {
      // New commits pushed — reconciler will pick up the new headSha
      return { dispatched: false };
    }

    if (event === "pull_request_review" && action === "submitted") {
      const review = payload.review as ReviewPayload;
      await handle.signal(SIGNAL_PR_REVIEW, {
        action: "submitted",
        state: review.state.toLowerCase(),
        reviewer: review.user.login,
      });
      return { dispatched: true, workflowId, signalName: SIGNAL_PR_REVIEW };
    }

    if (event === "pull_request_review" && action === "dismissed") {
      const review = payload.review as ReviewPayload;
      await handle.signal(SIGNAL_PR_REVIEW, {
        action: "dismissed",
        state: "dismissed",
        reviewer: review.user.login,
      });
      return { dispatched: true, workflowId, signalName: SIGNAL_PR_REVIEW };
    }

    if (event === "check_suite" && action === "completed") {
      const suite = payload.check_suite as CheckSuitePayload;
      // Dispatch to all PRs referenced by this check suite
      for (const pr of suite.pull_requests) {
        const wfId = await resolveWorkflowId(db, pr.number, repoFullName);
        if (!wfId) continue;
        try {
          const h = client.workflow.getHandle(wfId);
          await h.signal(SIGNAL_CHECK_COMPLETE, {
            checkName: suite.app.name,
            conclusion: suite.conclusion ?? "failure",
          });
        } catch {
          // Workflow may have completed
        }
      }
      return {
        dispatched: true,
        workflowId,
        signalName: SIGNAL_CHECK_COMPLETE,
      };
    }

    if (event === "check_run" && action === "completed") {
      const run = payload.check_run as CheckRunPayload;
      await handle.signal(SIGNAL_CHECK_COMPLETE, {
        checkName: run.name,
        conclusion: run.conclusion ?? "failure",
      });
      return {
        dispatched: true,
        workflowId,
        signalName: SIGNAL_CHECK_COMPLETE,
      };
    }

    return { dispatched: false };
  } catch {
    // Workflow not found or already completed — skip dispatch
    return { dispatched: false };
  }
}

async function dispatchMergeGroupEvent(
  client: Client,
  db: DbInstance,
  action: string | null,
  payload: Record<string, unknown>,
  repoFullName: string,
): Promise<DispatchResult> {
  if (action !== "checks_requested" && action !== "destroyed") {
    return { dispatched: false };
  }

  const status =
    action === "checks_requested" ? "checks_requested" : "destroyed";

  // merge_group payloads contain head_ref like "gh-readonly-queue/main/pr-42-<sha>"
  const mergeGroup = payload.merge_group as MergeGroupPayload | undefined;
  const headRef = mergeGroup?.head_ref;
  if (!headRef) return { dispatched: false };

  const prMatch = /\/pr-(\d+)-/.exec(headRef);
  if (!prMatch) return { dispatched: false };

  const prNumber = Number.parseInt(prMatch[1], 10);
  const workflowId = await resolveWorkflowId(db, prNumber, repoFullName);
  if (!workflowId) return { dispatched: false };

  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal(SIGNAL_MERGE_QUEUE_UPDATE, { status });
    return {
      dispatched: true,
      workflowId,
      signalName: SIGNAL_MERGE_QUEUE_UPDATE,
    };
  } catch {
    return { dispatched: false };
  }
}
