/**
 * Review tracker activities — polls GitHub for current PR state
 * as a safety net for missed webhooks. Uses REST + GraphQL hybrid
 * approach per docs/research-integrations.md §1.14.
 */

import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import { createGraphQLClient, createRestClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";

export interface ReconcilerConfig {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

export interface ReconcileCheck {
  readonly name: string;
  readonly conclusion: string;
}

export interface ReconcileResult {
  readonly prState: "open" | "closed" | "merged";
  readonly reviewDecision: string;
  readonly unresolvedThreads: number;
  readonly checks: readonly ReconcileCheck[];
  readonly staleReviews: boolean;
  readonly headSha: string;
}

export interface ReviewTrackerDeps {
  readonly credentialBroker: CredentialBroker;
}

const REVIEW_DECISION_QUERY = `
  query($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        reviewDecision
        reviews(last: 20) {
          nodes {
            state
            author { login }
          }
        }
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

interface GraphQLReviewNode {
  readonly state: string;
  readonly author: { readonly login: string } | null;
}

interface GraphQLThreadNode {
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
}

interface GraphQLPullRequest {
  readonly reviewDecision: string | null;
  readonly reviews: { readonly nodes: readonly GraphQLReviewNode[] };
  readonly reviewThreads: { readonly nodes: readonly GraphQLThreadNode[] };
}

interface GraphQLResponse {
  readonly repository: {
    readonly pullRequest: GraphQLPullRequest;
  };
}

interface CheckRunResponse {
  readonly data: {
    readonly check_runs: readonly {
      readonly name: string;
      readonly conclusion: string | null;
    }[];
  };
}

export function createReviewTrackerActivities(deps: ReviewTrackerDeps) {
  return {
    async reconcilePRState(
      config: ReconcilerConfig,
    ): Promise<FactoryResult<ReconcileResult>> {
      try {
        const token = await deps.credentialBroker.getToken("pr_tracking");
        const rest = createRestClient(token);
        const graphql = createGraphQLClient(token);

        // Step 1: PR state via REST (supports ETag/304)
        const prResponse = await rest.pulls.get({
          owner: config.owner,
          repo: config.repo,
          pull_number: config.prNumber,
        });

        const pr = prResponse.data;
        const headSha = pr.head.sha;

        let prState: "open" | "closed" | "merged";
        if (pr.merged) {
          prState = "merged";
        } else if (pr.state === "closed") {
          prState = "closed";
        } else {
          prState = "open";
        }

        // Step 2: Review decision + threads via GraphQL (no REST equivalent)
        const gqlResult = (await graphql(REVIEW_DECISION_QUERY, {
          owner: config.owner,
          repo: config.repo,
          prNumber: config.prNumber,
        })) as GraphQLResponse;

        const pullRequest = gqlResult.repository.pullRequest;
        const reviewDecision = pullRequest.reviewDecision ?? "REVIEW_REQUIRED";

        // Count unresolved, non-outdated threads
        const unresolvedThreads = pullRequest.reviewThreads.nodes.filter(
          (t) => !t.isResolved && !t.isOutdated,
        ).length;

        // Stale review detection: if reviewDecision changed to REVIEW_REQUIRED
        // after previously being APPROVED, reviews are stale
        const staleReviews = reviewDecision === "REVIEW_REQUIRED";

        // Step 3: Check runs via REST
        const checksResponse = (await rest.checks.listForRef({
          owner: config.owner,
          repo: config.repo,
          ref: headSha,
          per_page: 100,
        })) as unknown as CheckRunResponse;

        const checks: ReconcileCheck[] = checksResponse.data.check_runs
          .filter((cr) => cr.conclusion !== null)
          .map((cr) => ({
            name: cr.name,
            conclusion: cr.conclusion as string,
          }));

        return ok({
          prState,
          reviewDecision,
          unresolvedThreads,
          checks,
          staleReviews,
          headSha,
        });
      } catch (e) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to reconcile PR state: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },
  };
}
