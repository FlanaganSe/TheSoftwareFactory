/**
 * GitHub activities wrapper for Temporal.
 * Combines capability scan, branch operations, and trusted context capture
 * into a single activity set with ApplicationFailure error handling.
 */

import type {
  CapabilitySnapshot,
  FactoryError,
  TrustedBaseContext,
} from "@software-factory/core";
import { ApplicationFailure } from "@temporalio/activity";
import type { BranchActivityDeps, FileChange } from "./branch.js";
import { createBranchActivities } from "./branch.js";
import type { ScanLogger } from "./capability-scan.js";
import { scanRepository } from "./capability-scan.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { MutationSerializer } from "./rate-limiter.js";
import { createTrustedContextActivities } from "./trusted-context.js";

export interface GitHubActivityDeps {
  readonly credentialBroker: CredentialBroker;
  readonly serializer: MutationSerializer;
  readonly installationId: number;
  readonly logger?: ScanLogger;
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
  };
}
