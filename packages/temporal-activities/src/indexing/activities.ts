/**
 * Code indexing activities wrapper for Temporal.
 * Wraps the indexRepository pipeline with ApplicationFailure error handling.
 */

import type { PolicyConfig } from "@software-factory/core";
import type { DbInstance } from "@software-factory/db";
import { ApplicationFailure, heartbeat } from "@temporalio/activity";
import { indexRepository } from "./indexer.js";
import type { IndexResult } from "./types.js";

export interface IndexActivityDeps {
  readonly db: DbInstance;
}

export function createIndexActivities(deps: IndexActivityDeps) {
  return {
    /**
     * Index a repository: parse files, extract symbols, build repo map.
     * Heartbeats during long-running indexing operations.
     */
    async indexRepositoryActivity(
      repoPath: string,
      commitSha: string,
      repoId: string,
      policies: PolicyConfig[],
    ): Promise<IndexResult> {
      heartbeat("starting indexing");

      const result = await indexRepository(
        repoPath,
        commitSha,
        repoId,
        policies,
        deps.db,
      );

      if (result.isErr()) {
        throw ApplicationFailure.nonRetryable(
          result.error.message,
          result.error.code,
        );
      }

      heartbeat("indexing complete");
      return result.value;
    },
  };
}
