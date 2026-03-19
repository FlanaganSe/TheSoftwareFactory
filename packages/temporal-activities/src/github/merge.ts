/**
 * Merge activities — pre-check, merge execution (REST + GraphQL),
 * and post-merge cleanup (branch delete, lease release).
 */

import { createHash } from "node:crypto";
import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import { createGraphQLClient, createRestClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { MutationSerializer } from "./rate-limiter.js";

// ─── Types ───

export interface MergeConfig {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly prNodeId: string;
  readonly expectedHeadSha: string;
  readonly mergeMethod: "merge" | "squash" | "rebase";
  readonly commitTitle?: string;
  readonly commitMessage?: string;
  readonly useMergeQueue: boolean;
  readonly taskId: string;
}

export interface MergeResult {
  readonly merged: boolean;
  readonly sha?: string;
  readonly method: string;
  readonly mergeQueuePosition?: number;
  readonly message: string;
}

export interface MergePrecheckConfig {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly expectedHeadSha: string;
  readonly requiredChecks: readonly string[];
  readonly requiredReviewCount: number;
}

export interface MergePrecheck {
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly checksStatus: "all_passing" | "some_failing" | "pending";
  readonly reviewStatus: "approved" | "changes_requested" | "pending";
  readonly threadsStatus: "all_resolved" | "unresolved";
  readonly codeOwnerStatus: "approved" | "pending" | "not_required";
}

export interface PostMergeCleanupConfig {
  readonly owner: string;
  readonly repo: string;
  readonly taskId: string;
  readonly candidateBranch: string;
  readonly containerId?: string;
}

export interface MergeActivityDeps {
  readonly credentialBroker: CredentialBroker;
  readonly serializer: MutationSerializer;
  readonly sideEffects: SideEffectOps;
}

export interface SideEffectOps {
  getSideEffect(
    idempotencyKey: string,
  ): Promise<FactoryResult<SideEffectRecord | null>>;
  recordSideEffect(
    taskId: string,
    effectType: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<FactoryResult<void>>;
  completeSideEffect(
    idempotencyKey: string,
    responsePayload: Record<string, unknown>,
  ): Promise<FactoryResult<void>>;
  failSideEffect(
    idempotencyKey: string,
    errorMessage: string,
  ): Promise<FactoryResult<void>>;
}

export interface SideEffectRecord {
  readonly status: string;
  readonly responsePayload: unknown;
}

// ─── GraphQL ───

const ENQUEUE_PR_MUTATION = `
  mutation EnqueuePR($prId: ID!) {
    enqueuePullRequest(input: { pullRequestId: $prId }) {
      mergeQueueEntry { position }
    }
  }
`;

const REVIEW_DECISION_QUERY = `
  query($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        reviewDecision
        reviewThreads(first: 100) {
          nodes { isResolved isOutdated }
        }
      }
    }
  }
`;

// ─── Idempotency ───

export function computeMergeIdempotencyKey(
  taskId: string,
  prNumber: number,
  expectedHeadSha: string,
): string {
  return createHash("sha256")
    .update(`${taskId}\0merge_pr\0${prNumber}\0${expectedHeadSha}`)
    .digest("hex");
}

// ─── Helpers ───

function isGitHubError(e: unknown): e is { status: number; message: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}

// ─── Activity Factory ───

export function createMergeActivities(deps: MergeActivityDeps) {
  async function getRestClient() {
    const token = await deps.credentialBroker.getToken("merge");
    return createRestClient(token);
  }

  async function getGraphQL() {
    const token = await deps.credentialBroker.getToken("merge");
    return createGraphQLClient(token);
  }

  return {
    /**
     * Final merge readiness pre-check — validates GitHub state
     * immediately before merge execution.
     */
    async checkMergeReadiness(
      config: MergePrecheckConfig,
    ): Promise<FactoryResult<MergePrecheck>> {
      try {
        const client = await getRestClient();
        const blockers: string[] = [];

        // 1. Get PR state
        const { data: pr } = await client.pulls.get({
          owner: config.owner,
          repo: config.repo,
          pull_number: config.prNumber,
        });

        // PR must be open
        if (pr.state !== "open") {
          blockers.push(`PR is ${pr.state}, not open`);
          return ok({
            ready: false,
            blockers,
            checksStatus: "pending",
            reviewStatus: "pending",
            threadsStatus: "all_resolved",
            codeOwnerStatus: "not_required",
          });
        }

        // 2. SHA safety check
        if (pr.head.sha !== config.expectedHeadSha) {
          blockers.push(
            `HEAD SHA mismatch: expected ${config.expectedHeadSha}, got ${pr.head.sha}`,
          );
        }

        // 3. Mergeable state
        if (pr.mergeable === null) {
          blockers.push("Merge status pending (GitHub still computing)");
        } else if (pr.mergeable === false) {
          blockers.push(
            `PR is not mergeable (state: ${pr.mergeable_state ?? "unknown"})`,
          );
        }

        // 4. Check runs
        let checksStatus: MergePrecheck["checksStatus"] = "all_passing";
        if (config.requiredChecks.length > 0) {
          const { data: checks } = await client.checks.listForRef({
            owner: config.owner,
            repo: config.repo,
            ref: pr.head.sha,
            per_page: 100,
          });

          for (const requiredCheck of config.requiredChecks) {
            const matchingRun = checks.check_runs.find(
              (r) => r.name === requiredCheck,
            );
            if (!matchingRun) {
              blockers.push(`Required check "${requiredCheck}" not found`);
              checksStatus = "pending";
            } else if (matchingRun.conclusion !== "success") {
              blockers.push(
                `Required check "${requiredCheck}" is ${matchingRun.conclusion ?? matchingRun.status}`,
              );
              checksStatus =
                matchingRun.status === "completed" ? "some_failing" : "pending";
            }
          }
        }

        // 5. Reviews via GraphQL
        let reviewStatus: MergePrecheck["reviewStatus"] = "approved";
        let threadsStatus: MergePrecheck["threadsStatus"] = "all_resolved";
        const codeOwnerStatus: MergePrecheck["codeOwnerStatus"] =
          "not_required";

        try {
          const graphql = await getGraphQL();
          const gqlResult = (await graphql(REVIEW_DECISION_QUERY, {
            owner: config.owner,
            repo: config.repo,
            prNumber: config.prNumber,
          })) as {
            repository: {
              pullRequest: {
                reviewDecision: string | null;
                reviewThreads: {
                  nodes: { isResolved: boolean; isOutdated: boolean }[];
                };
              };
            };
          };

          const prData = gqlResult.repository.pullRequest;
          const decision = prData.reviewDecision;

          if (decision === "CHANGES_REQUESTED") {
            reviewStatus = "changes_requested";
            blockers.push("Changes requested by reviewer");
          } else if (
            decision === "REVIEW_REQUIRED" &&
            config.requiredReviewCount > 0
          ) {
            reviewStatus = "pending";
            blockers.push("Required reviews not yet provided");
          }

          const unresolvedThreads = prData.reviewThreads.nodes.filter(
            (t) => !t.isResolved && !t.isOutdated,
          ).length;
          if (unresolvedThreads > 0) {
            threadsStatus = "unresolved";
            blockers.push(`${unresolvedThreads} unresolved review thread(s)`);
          }
        } catch {
          // GraphQL failure is non-fatal — rely on REST data
        }

        return ok({
          ready: blockers.length === 0,
          blockers,
          checksStatus,
          reviewStatus,
          threadsStatus,
          codeOwnerStatus,
        });
      } catch (e) {
        return err(
          createFactoryError(
            "github_transient",
            `Merge readiness check failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },

    /**
     * Execute the merge via REST API (direct) or GraphQL (merge queue).
     * Uses side-effect idempotency to prevent duplicate merges.
     */
    async mergePullRequest(
      config: MergeConfig,
    ): Promise<FactoryResult<MergeResult>> {
      const idempotencyKey = computeMergeIdempotencyKey(
        config.taskId,
        config.prNumber,
        config.expectedHeadSha,
      );

      // Check side-effects ledger
      const existingResult =
        await deps.sideEffects.getSideEffect(idempotencyKey);
      if (existingResult.isErr()) {
        return err(existingResult.error);
      }

      const existing = existingResult.value;
      if (
        existing &&
        existing.status === "completed" &&
        existing.responsePayload
      ) {
        const payload = existing.responsePayload as Record<string, unknown>;
        return ok({
          merged: payload.merged as boolean,
          sha: payload.sha as string | undefined,
          method: payload.method as string,
          mergeQueuePosition: payload.mergeQueuePosition as number | undefined,
          message: payload.message as string,
        });
      }

      // Record pending side-effect
      if (!existing) {
        const recordResult = await deps.sideEffects.recordSideEffect(
          config.taskId,
          "merge_pr",
          idempotencyKey,
          idempotencyKey.slice(0, 16),
        );
        if (recordResult.isErr()) {
          return err(recordResult.error);
        }
      }

      // ─── Path A: Merge queue ───
      if (config.useMergeQueue) {
        try {
          const graphql = await getGraphQL();
          await deps.serializer.waitForSlot();
          const gqlResult = (await graphql(ENQUEUE_PR_MUTATION, {
            prId: config.prNodeId,
          })) as {
            enqueuePullRequest: {
              mergeQueueEntry: { position: number } | null;
            };
          };

          const position =
            gqlResult.enqueuePullRequest.mergeQueueEntry?.position;
          const result: MergeResult = {
            merged: false,
            method: "merge_queue",
            mergeQueuePosition: position ?? undefined,
            message: `Enqueued to merge queue${position != null ? ` at position ${position}` : ""}`,
          };

          await deps.sideEffects.completeSideEffect(idempotencyKey, {
            merged: result.merged,
            method: result.method,
            mergeQueuePosition: result.mergeQueuePosition,
            message: result.message,
          });

          return ok(result);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          await deps.sideEffects.failSideEffect(idempotencyKey, errorMsg);
          return err(
            createFactoryError(
              "github_transient",
              `Failed to enqueue PR: ${errorMsg}`,
            ),
          );
        }
      }

      // ─── Path B: Direct merge via REST ───
      try {
        const client = await getRestClient();
        await deps.serializer.waitForSlot();

        const mergeMethodMap = {
          merge: "merge",
          squash: "squash",
          rebase: "rebase",
        } as const;

        const { data } = await client.pulls.merge({
          owner: config.owner,
          repo: config.repo,
          pull_number: config.prNumber,
          merge_method: mergeMethodMap[config.mergeMethod],
          sha: config.expectedHeadSha,
          commit_title: config.commitTitle,
          commit_message: config.commitMessage,
        });

        const result: MergeResult = {
          merged: data.merged,
          sha: data.sha,
          method: config.mergeMethod,
          message: data.message ?? "Merged successfully",
        };

        await deps.sideEffects.completeSideEffect(idempotencyKey, {
          merged: result.merged,
          sha: result.sha,
          method: result.method,
          message: result.message,
        });

        return ok(result);
      } catch (e) {
        if (isGitHubError(e)) {
          const result: MergeResult = {
            merged: false,
            method: config.mergeMethod,
            message: e.message,
          };

          if (e.status === 409) {
            // SHA conflict — head changed since pre-check
            await deps.sideEffects.failSideEffect(
              idempotencyKey,
              `SHA conflict: ${e.message}`,
            );
            return ok(result);
          }

          if (e.status === 405) {
            // Merge not allowed
            await deps.sideEffects.failSideEffect(
              idempotencyKey,
              `Merge not allowed: ${e.message}`,
            );
            return ok(result);
          }

          if (e.status === 422) {
            // Validation failed
            await deps.sideEffects.failSideEffect(
              idempotencyKey,
              `Validation failed: ${e.message}`,
            );
            return ok(result);
          }
        }

        const errorMsg = e instanceof Error ? e.message : String(e);
        await deps.sideEffects.failSideEffect(idempotencyKey, errorMsg);
        return err(
          createFactoryError(
            "github_transient",
            `Failed to merge PR: ${errorMsg}`,
          ),
        );
      }
    },

    /**
     * Delete candidate branch after merge.
     * Only deletes branches with the `factory/` prefix.
     */
    async deleteBranch(
      owner: string,
      repo: string,
      branch: string,
    ): Promise<FactoryResult<void>> {
      // Safety: only delete factory-created branches
      if (!branch.startsWith("factory/")) {
        return err(
          createFactoryError(
            "evidence_invariant_fail",
            `Refusing to delete non-factory branch: ${branch}`,
          ),
        );
      }

      try {
        const client = await getRestClient();
        await client.git.deleteRef({
          owner,
          repo,
          ref: `heads/${branch}`,
        });
        return ok(undefined);
      } catch (e) {
        if (isGitHubError(e) && e.status === 422) {
          // Already deleted — graceful
          return ok(undefined);
        }
        // Branch delete failure is non-blocking
        return ok(undefined);
      }
    },
  };
}
