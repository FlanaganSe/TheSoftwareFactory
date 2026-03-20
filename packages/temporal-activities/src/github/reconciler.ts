/**
 * System-level GitHub reconciler.
 *
 * M17 built a per-workflow PR reconciler (review-tracker.ts).
 * This module adds a BROADER reconciler that periodically syncs
 * ALL active resources across the factory, catching any state drift.
 *
 * ETag caching for conditional requests is planned but not yet implemented.
 */

import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import type { DbInstance } from "@software-factory/db";
import {
  auditEntries,
  computeContentHash,
  repos,
  reviewStates,
  tasks,
} from "@software-factory/db";
import { eq, notInArray } from "drizzle-orm";
import { err, ok } from "neverthrow";
import { createGraphQLClient, createRestClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";

export interface BroadReconcilerConfig {
  readonly db: DbInstance;
  readonly credentialBroker: CredentialBroker;
  readonly redisUrl?: string;
}

export interface ReconciliationReport {
  readonly activePRsChecked: number;
  readonly staleDetected: number;
  readonly driftDetected: number;
  readonly signalsSent: number;
  readonly errors: readonly string[];
  readonly durationMs: number;
}

export interface PRDriftResult {
  readonly taskId: string;
  readonly prNumber: number;
  readonly owner: string;
  readonly repo: string;
  readonly drifts: readonly string[];
}

interface ActivePR {
  readonly taskId: string;
  readonly prNumber: number;
  readonly headSha: string | null;
  readonly owner: string;
  readonly repo: string;
}

const REVIEW_DECISION_QUERY = `
  query($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        state
        merged
        reviewDecision
        headRefOid
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
          }
        }
      }
    }
  }
`;

interface GraphQLPRResponse {
  readonly repository: {
    readonly pullRequest: {
      readonly state: string;
      readonly merged: boolean;
      readonly reviewDecision: string | null;
      readonly headRefOid: string;
      readonly reviewThreads: {
        readonly nodes: readonly {
          readonly isResolved: boolean;
          readonly isOutdated: boolean;
        }[];
      };
    };
  };
}

export function createBroadReconciler(config: BroadReconcilerConfig) {
  const { db, credentialBroker } = config;

  async function getActivePRs(): Promise<readonly ActivePR[]> {
    const terminalStates = ["merged", "failed", "cancelled"] as const;

    const rows = await db
      .select({
        taskId: tasks.id,
        prNumber: reviewStates.prNumber,
        headSha: reviewStates.headSha,
        owner: repos.githubOwner,
        repo: repos.githubRepo,
      })
      .from(tasks)
      .innerJoin(reviewStates, eq(reviewStates.taskId, tasks.id))
      .innerJoin(repos, eq(repos.id, tasks.repoId))
      .where(notInArray(tasks.state, [...terminalStates]));

    return rows
      .filter((r) => r.prNumber !== null)
      .map((r) => ({
        taskId: r.taskId,
        prNumber: r.prNumber as number,
        headSha: r.headSha,
        owner: r.owner,
        repo: r.repo,
      }));
  }

  async function reconcileActivePRs(): Promise<Partial<ReconciliationReport>> {
    const activePRs = await getActivePRs();

    if (activePRs.length === 0) {
      return {
        activePRsChecked: 0,
        staleDetected: 0,
        driftDetected: 0,
        signalsSent: 0,
        errors: [],
      };
    }

    const token = await credentialBroker.getToken("pr_tracking");
    const graphql = createGraphQLClient(token);
    const errors: string[] = [];
    let driftDetected = 0;
    let staleDetected = 0;

    for (const pr of activePRs) {
      try {
        const result = (await graphql(REVIEW_DECISION_QUERY, {
          owner: pr.owner,
          repo: pr.repo,
          prNumber: pr.prNumber,
        })) as GraphQLPRResponse;

        const ghPR = result.repository.pullRequest;

        // Check for head SHA drift
        if (pr.headSha && ghPR.headRefOid !== pr.headSha) {
          driftDetected++;
        }

        // Check for merged/closed state that we missed
        if (ghPR.merged || ghPR.state === "CLOSED") {
          driftDetected++;
        }

        // Check for stale reviews
        if (ghPR.reviewDecision === "REVIEW_REQUIRED") {
          staleDetected++;
        }
      } catch (e) {
        errors.push(
          `PR ${pr.owner}/${pr.repo}#${pr.prNumber}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return {
      activePRsChecked: activePRs.length,
      staleDetected,
      driftDetected,
      signalsSent: 0, // Signals are sent by the per-workflow reconciler in review-tracker.ts
      errors,
    };
  }

  async function reconcileRepositoryMetadata(): Promise<
    Partial<ReconciliationReport>
  > {
    // Check that repo metadata (default branch, visibility) hasn't changed
    const allRepos = await db
      .select({
        id: repos.id,
        owner: repos.githubOwner,
        repo: repos.githubRepo,
        defaultBranch: repos.defaultBranch,
      })
      .from(repos);

    if (allRepos.length === 0) {
      return { driftDetected: 0, errors: [] };
    }

    const token = await credentialBroker.getToken("capability_scan");
    const rest = createRestClient(token);
    const errors: string[] = [];
    let driftDetected = 0;

    for (const repo of allRepos) {
      try {
        const response = await rest.repos.get({
          owner: repo.owner,
          repo: repo.repo,
        });

        if (response.data.default_branch !== repo.defaultBranch) {
          driftDetected++;
          // State change + audit entry in a single transaction
          await db.transaction(async (tx) => {
            await tx
              .update(repos)
              .set({ defaultBranch: response.data.default_branch })
              .where(eq(repos.id, repo.id));

            const content = {
              previousBranch: repo.defaultBranch,
              newBranch: response.data.default_branch,
            };
            await tx.insert(auditEntries).values({
              actor: "system:reconciler",
              actionType: "repo_metadata_drift",
              targetType: "repo",
              targetId: repo.id,
              result: "corrected",
              content,
              contentHash: computeContentHash(content),
            });
          });
        }
      } catch (e) {
        errors.push(
          `Repo ${repo.owner}/${repo.repo}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return { driftDetected, errors };
  }

  async function reconcileBranchProtection(): Promise<
    Partial<ReconciliationReport>
  > {
    // Stub — checks branch protection rules haven't changed.
    // Full implementation would compare cached rules against current.
    return { driftDetected: 0, errors: [] };
  }

  return {
    reconcileActivePRs,
    reconcileRepositoryMetadata,
    reconcileBranchProtection,

    async reconcileAll(): Promise<FactoryResult<ReconciliationReport>> {
      const start = Date.now();
      try {
        const [prResult, repoResult, protectionResult] = await Promise.all([
          reconcileActivePRs(),
          reconcileRepositoryMetadata(),
          reconcileBranchProtection(),
        ]);

        const allErrors = [
          ...(prResult.errors ?? []),
          ...(repoResult.errors ?? []),
          ...(protectionResult.errors ?? []),
        ];

        return ok({
          activePRsChecked: prResult.activePRsChecked ?? 0,
          staleDetected: prResult.staleDetected ?? 0,
          driftDetected:
            (prResult.driftDetected ?? 0) +
            (repoResult.driftDetected ?? 0) +
            (protectionResult.driftDetected ?? 0),
          signalsSent: prResult.signalsSent ?? 0,
          errors: allErrors,
          durationMs: Date.now() - start,
        });
      } catch (e) {
        return err(
          createFactoryError(
            "github_transient",
            `Reconciliation failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },
  };
}

/**
 * Activity wrapper for the broad reconciler.
 * Called by the reconciliation scheduled workflow.
 */
export function createBroadReconcilerActivities(config: BroadReconcilerConfig) {
  const reconciler = createBroadReconciler(config);

  return {
    async reconcileAllResources(): Promise<ReconciliationReport> {
      const result = await reconciler.reconcileAll();
      if (result.isErr()) {
        throw new Error(result.error.message);
      }
      return result.value;
    },

    async reconcileActivePRs(): Promise<Partial<ReconciliationReport>> {
      return reconciler.reconcileActivePRs();
    },
  };
}
