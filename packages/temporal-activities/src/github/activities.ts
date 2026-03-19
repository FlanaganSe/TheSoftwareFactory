/**
 * GitHub activities wrapper for Temporal.
 * Combines capability scan, branch operations, trusted context capture,
 * PR creation, check runs, and auto-merge into a single activity set
 * with ApplicationFailure error handling.
 */

import type {
  CapabilitySnapshot,
  FactoryError,
  TrustedBaseContext,
} from "@software-factory/core";
import {
  type DbInstance,
  reviewStateRepo,
  sideEffectRepo,
} from "@software-factory/db";
import { ApplicationFailure } from "@temporalio/activity";
import type { MergeMethod } from "./auto-merge.js";
import { createAutoMergeActivities } from "./auto-merge.js";
import type { BranchActivityDeps, FileChange } from "./branch.js";
import { createBranchActivities } from "./branch.js";
import type { ScanLogger } from "./capability-scan.js";
import { scanRepository } from "./capability-scan.js";
import type {
  CheckRunConfig,
  CheckRunResult,
  CheckRunUpdates,
} from "./check-run.js";
import { createCheckRunActivities } from "./check-run.js";
import type { CredentialBroker } from "./credential-broker.js";
import type {
  MergeConfig,
  MergePrecheck,
  MergePrecheckConfig,
  MergeResult,
} from "./merge.js";
import { createMergeActivities } from "./merge.js";
import type { CreatePRConfig, PRResult, PRUpdates } from "./pr.js";
import { createPRActivities } from "./pr.js";
import type { SideEffectOps } from "./pr.js";
import type { MutationSerializer } from "./rate-limiter.js";
import type { ReconcileResult, ReconcilerConfig } from "./review-tracker.js";
import { createReviewTrackerActivities } from "./review-tracker.js";
import { createTrustedContextActivities } from "./trusted-context.js";

export interface GitHubActivityDeps {
  readonly credentialBroker: CredentialBroker;
  readonly serializer: MutationSerializer;
  readonly installationId: number;
  readonly logger?: ScanLogger;
  readonly db?: DbInstance;
  readonly apiUrl?: string;
}

function toApplicationFailure(error: FactoryError): ApplicationFailure {
  return error.retryable
    ? ApplicationFailure.retryable(error.message, error.code)
    : ApplicationFailure.nonRetryable(error.message, error.code);
}

export function createGitHubActivities(deps: GitHubActivityDeps) {
  const branchDeps: BranchActivityDeps = {
    credentialBroker: deps.credentialBroker,
    serializer: deps.serializer,
  };
  const branchActivities = createBranchActivities(branchDeps);
  const trustedContextActivities = createTrustedContextActivities({
    credentialBroker: deps.credentialBroker,
  });

  return {
    async scanRepository(
      owner: string,
      repo: string,
    ): Promise<CapabilitySnapshot> {
      const result = await scanRepository(
        owner,
        repo,
        deps.credentialBroker,
        deps.installationId,
        deps.logger,
      );
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async captureTrustedContext(
      owner: string,
      repo: string,
      defaultBranch: string,
    ): Promise<TrustedBaseContext> {
      const result = await trustedContextActivities.captureTrustedContext(
        owner,
        repo,
        defaultBranch,
      );
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async createCandidateBranch(
      owner: string,
      repo: string,
      branchName: string,
      baseSha: string,
    ): Promise<{ ref: string; sha: string }> {
      const result = await branchActivities.createCandidateBranch(
        owner,
        repo,
        branchName,
        baseSha,
      );
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async pushChanges(
      owner: string,
      repo: string,
      branchName: string,
      parentSha: string,
      changes: FileChange[],
      commitMessage: string,
    ): Promise<{ commitSha: string }> {
      const result = await branchActivities.pushChanges(
        owner,
        repo,
        branchName,
        parentSha,
        changes,
        commitMessage,
      );
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    async cloneRepo(
      owner: string,
      repo: string,
      targetPath: string,
    ): Promise<{ path: string; headSha: string }> {
      const result = await branchActivities.cloneRepo(owner, repo, targetPath);
      if (result.isErr()) throw toApplicationFailure(result.error);
      return result.value;
    },

    // ─── PR Activities (M16) ───

    ...(deps.db
      ? (() => {
          const db = deps.db;
          const apiUrl = deps.apiUrl ?? "http://localhost:3000";

          const sideEffects: SideEffectOps = {
            async getSideEffect(idempotencyKey) {
              return sideEffectRepo.getSideEffect(db, idempotencyKey);
            },
            async recordSideEffect(
              taskId,
              effectType,
              idempotencyKey,
              requestHash,
            ) {
              return sideEffectRepo.recordSideEffect(
                db,
                taskId,
                effectType,
                idempotencyKey,
                requestHash,
              );
            },
            async completeSideEffect(idempotencyKey, responsePayload) {
              return sideEffectRepo.completeSideEffect(
                db,
                idempotencyKey,
                responsePayload,
              );
            },
            async failSideEffect(idempotencyKey, errorMessage) {
              return sideEffectRepo.failSideEffect(
                db,
                idempotencyKey,
                errorMessage,
              );
            },
          };

          const prActivities = createPRActivities({
            credentialBroker: deps.credentialBroker,
            serializer: deps.serializer,
            sideEffects,
          });

          const checkRunActivities = createCheckRunActivities({
            credentialBroker: deps.credentialBroker,
            serializer: deps.serializer,
            sideEffects,
          });

          const autoMergeActivities = createAutoMergeActivities({
            credentialBroker: deps.credentialBroker,
            serializer: deps.serializer,
          });

          return {
            async createPullRequest(config: CreatePRConfig): Promise<PRResult> {
              const result = await prActivities.createPullRequest(
                config,
                apiUrl,
              );
              if (result.isErr()) throw toApplicationFailure(result.error);
              return result.value;
            },

            async updatePullRequest(
              owner: string,
              repo: string,
              prNumber: number,
              updates: PRUpdates,
            ): Promise<void> {
              const result = await prActivities.updatePullRequest(
                owner,
                repo,
                prNumber,
                updates,
              );
              if (result.isErr()) throw toApplicationFailure(result.error);
            },

            async createFactoryCheckRun(
              config: CheckRunConfig,
            ): Promise<CheckRunResult> {
              const result =
                await checkRunActivities.createFactoryCheckRun(config);
              if (result.isErr()) throw toApplicationFailure(result.error);
              return result.value;
            },

            async updateCheckRun(
              owner: string,
              repo: string,
              checkRunId: number,
              updates: CheckRunUpdates,
            ): Promise<void> {
              const result = await checkRunActivities.updateCheckRun(
                owner,
                repo,
                checkRunId,
                updates,
              );
              if (result.isErr()) throw toApplicationFailure(result.error);
            },

            async uploadSarif(
              owner: string,
              repo: string,
              commitSha: string,
              sarifContent: string,
            ): Promise<void> {
              const result = await checkRunActivities.uploadSarif(
                owner,
                repo,
                commitSha,
                sarifContent,
              );
              if (result.isErr()) throw toApplicationFailure(result.error);
            },

            async enableAutoMerge(
              owner: string,
              repo: string,
              prNodeId: string,
              mergeMethod: MergeMethod,
            ): Promise<void> {
              const result = await autoMergeActivities.enableAutoMerge(
                owner,
                repo,
                prNodeId,
                mergeMethod,
              );
              if (result.isErr()) throw toApplicationFailure(result.error);
            },

            async enqueuePullRequest(
              owner: string,
              repo: string,
              prNodeId: string,
            ): Promise<void> {
              const result = await autoMergeActivities.enqueuePullRequest(
                owner,
                repo,
                prNodeId,
              );
              if (result.isErr()) throw toApplicationFailure(result.error);
            },

            async createReviewState(
              input: reviewStateRepo.CreateReviewStateInput,
            ): Promise<void> {
              const result = await reviewStateRepo.createReviewState(db, input);
              if (result.isErr()) throw toApplicationFailure(result.error);
            },

            async getReviewState(taskId: string): Promise<{
              id: string;
              taskId: string;
              prNumber: number | null;
              prUrl: string | null;
              prNodeId: string | null;
              headSha: string | null;
              mergeQueueStatus: string | null;
            } | null> {
              const result = await reviewStateRepo.getReviewState(db, taskId);
              if (result.isErr()) throw toApplicationFailure(result.error);
              return result.value;
            },

            async updateReviewState(
              taskId: string,
              updates: Partial<reviewStateRepo.ReviewStateUpdates>,
            ): Promise<void> {
              const result = await reviewStateRepo.updateReviewState(
                db,
                taskId,
                updates,
              );
              if (result.isErr()) throw toApplicationFailure(result.error);
            },

            // ─── Merge Activities (M18) ───

            ...(() => {
              const mergeActs = createMergeActivities({
                credentialBroker: deps.credentialBroker,
                serializer: deps.serializer,
                sideEffects,
              });
              return {
                async checkMergeReadiness(
                  config: MergePrecheckConfig,
                ): Promise<MergePrecheck> {
                  const result = await mergeActs.checkMergeReadiness(config);
                  if (result.isErr()) throw toApplicationFailure(result.error);
                  return result.value;
                },

                async mergePullRequest(
                  config: MergeConfig,
                ): Promise<MergeResult> {
                  const result = await mergeActs.mergePullRequest(config);
                  if (result.isErr()) throw toApplicationFailure(result.error);
                  return result.value;
                },

                async deleteBranch(
                  owner: string,
                  repo: string,
                  branch: string,
                ): Promise<void> {
                  const result = await mergeActs.deleteBranch(
                    owner,
                    repo,
                    branch,
                  );
                  if (result.isErr()) throw toApplicationFailure(result.error);
                },
              };
            })(),

            // ─── Review Tracker (M17) ───

            ...(() => {
              const tracker = createReviewTrackerActivities({
                credentialBroker: deps.credentialBroker,
              });
              return {
                async reconcilePRState(
                  config: ReconcilerConfig,
                ): Promise<ReconcileResult> {
                  const result = await tracker.reconcilePRState(config);
                  if (result.isErr()) throw toApplicationFailure(result.error);
                  return result.value;
                },
              };
            })(),
          };
        })()
      : {}),
  };
}
