/**
 * Git Database API operations: branch creation, 6-step commit push, shallow clone.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import type { Octokit } from "@octokit/rest";
import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import { createRestClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { MutationSerializer } from "./rate-limiter.js";

export interface FileChange {
  readonly path: string;
  readonly content: string;
  readonly mode: "100644" | "100755";
}

export interface BranchActivityDeps {
  readonly credentialBroker: CredentialBroker;
  readonly serializer: MutationSerializer;
}

export function createBranchActivities(deps: BranchActivityDeps) {
  async function getClient(): Promise<Octokit> {
    const token = await deps.credentialBroker.getToken("implementation");
    return createRestClient(token);
  }

  return {
    /**
     * Create a candidate branch pointing at baseSha.
     * If the branch already exists, update it to point at baseSha.
     */
    async createCandidateBranch(
      owner: string,
      repo: string,
      branchName: string,
      baseSha: string,
    ): Promise<FactoryResult<{ ref: string; sha: string }>> {
      try {
        const client = await getClient();
        await deps.serializer.waitForSlot();

        try {
          const { data } = await client.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${branchName}`,
            sha: baseSha,
          });
          return ok({ ref: data.ref, sha: data.object.sha });
        } catch (e: unknown) {
          // Branch already exists — update it
          if (isGitHubError(e) && e.status === 422) {
            await deps.serializer.waitForSlot();
            const { data } = await client.git.updateRef({
              owner,
              repo,
              ref: `heads/${branchName}`,
              sha: baseSha,
              force: true,
            });
            return ok({ ref: data.ref, sha: data.object.sha });
          }
          throw e;
        }
      } catch (error) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to create branch ${branchName}: ${String(error)}`,
          ),
        );
      }
    },

    /**
     * Push changes via the Git Database API 6-step sequence.
     * Commits are auto-signed by GitHub as the App identity.
     * Uses MutationSerializer for 1s between mutations.
     */
    async pushChanges(
      owner: string,
      repo: string,
      branchName: string,
      parentSha: string,
      changes: readonly FileChange[],
      commitMessage: string,
    ): Promise<FactoryResult<{ commitSha: string }>> {
      try {
        const client = await getClient();

        // Step 1: Get current commit to find tree SHA
        const { data: commitData } = await client.git.getCommit({
          owner,
          repo,
          commit_sha: parentSha,
        });
        const baseTreeSha = commitData.tree.sha;

        // Step 2: Create blobs for each changed file
        const treeEntries: Array<{
          path: string;
          mode: "100644" | "100755";
          type: "blob";
          sha: string;
        }> = [];

        for (const change of changes) {
          await deps.serializer.waitForSlot();
          const { data: blob } = await client.git.createBlob({
            owner,
            repo,
            content: Buffer.from(change.content).toString("base64"),
            encoding: "base64",
          });
          treeEntries.push({
            path: change.path,
            mode: change.mode,
            type: "blob",
            sha: blob.sha,
          });
        }

        // Step 3: Create tree with base_tree + new blobs
        await deps.serializer.waitForSlot();
        const { data: tree } = await client.git.createTree({
          owner,
          repo,
          base_tree: baseTreeSha,
          tree: treeEntries,
        });

        // Step 4: Create commit (no custom author → auto-signed by App)
        await deps.serializer.waitForSlot();
        const { data: newCommit } = await client.git.createCommit({
          owner,
          repo,
          message: commitMessage,
          tree: tree.sha,
          parents: [parentSha],
        });

        // Step 5: Update ref to point at new commit
        await deps.serializer.waitForSlot();
        await client.git.updateRef({
          owner,
          repo,
          ref: `heads/${branchName}`,
          sha: newCommit.sha,
        });

        return ok({ commitSha: newCommit.sha });
      } catch (error) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to push changes to ${branchName}: ${String(error)}`,
          ),
        );
      }
    },

    /**
     * Shallow clone a repository to a target directory.
     * Uses the GitHub App installation token for auth.
     */
    async cloneRepo(
      owner: string,
      repo: string,
      targetPath: string,
    ): Promise<FactoryResult<{ path: string; headSha: string }>> {
      try {
        const token = await deps.credentialBroker.getToken("implementation");
        const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

        if (!existsSync(targetPath)) {
          mkdirSync(targetPath, { recursive: true });
        }

        execFileSync("git", ["clone", "--depth", "1", cloneUrl, targetPath], {
          timeout: 120_000,
          stdio: "pipe",
        });

        const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: targetPath,
          encoding: "utf8",
          stdio: "pipe",
        }).trim();

        return ok({ path: targetPath, headSha });
      } catch (error) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to clone ${owner}/${repo}: ${String(error)}`,
          ),
        );
      }
    },
  };
}

function isGitHubError(e: unknown): e is { status: number; message: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}
