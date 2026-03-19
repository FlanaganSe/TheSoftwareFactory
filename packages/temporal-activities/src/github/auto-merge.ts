/**
 * Auto-merge and merge queue activities — GraphQL mutations
 * for enabling auto-merge or enqueuing to merge queue.
 * These are best-effort: failure does not block PR creation.
 */

import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import { createGraphQLClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { MutationSerializer } from "./rate-limiter.js";

// ─── Types ───

export type MergeMethod = "MERGE" | "SQUASH" | "REBASE";

export interface AutoMergeActivityDeps {
  readonly credentialBroker: CredentialBroker;
  readonly serializer: MutationSerializer;
}

// ─── GraphQL Mutations ───

const ENABLE_AUTO_MERGE_MUTATION = `
  mutation EnableAutoMerge($prId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: {
      pullRequestId: $prId
      mergeMethod: $mergeMethod
    }) {
      pullRequest { autoMergeRequest { enabledAt } }
    }
  }
`;

const ENQUEUE_PR_MUTATION = `
  mutation EnqueuePR($prId: ID!) {
    enqueuePullRequest(input: { pullRequestId: $prId }) {
      mergeQueueEntry { position }
    }
  }
`;

// ─── Activity Factory ───

export function createAutoMergeActivities(deps: AutoMergeActivityDeps) {
  async function getGraphQL() {
    const token = await deps.credentialBroker.getToken("pr_creation");
    return createGraphQLClient(token);
  }

  return {
    async enableAutoMerge(
      _owner: string,
      _repo: string,
      prNodeId: string,
      mergeMethod: MergeMethod,
    ): Promise<FactoryResult<void>> {
      try {
        const graphql = await getGraphQL();
        await deps.serializer.waitForSlot();
        await graphql(ENABLE_AUTO_MERGE_MUTATION, {
          prId: prNodeId,
          mergeMethod,
        });
        return ok(undefined);
      } catch (e) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to enable auto-merge: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },

    async enqueuePullRequest(
      _owner: string,
      _repo: string,
      prNodeId: string,
    ): Promise<FactoryResult<void>> {
      try {
        const graphql = await getGraphQL();
        await deps.serializer.waitForSlot();
        await graphql(ENQUEUE_PR_MUTATION, {
          prId: prNodeId,
        });
        return ok(undefined);
      } catch (e) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to enqueue PR: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },
  };
}
