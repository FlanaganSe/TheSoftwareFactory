/**
 * TrustedBaseContext capture activity.
 *
 * Captures the base SHA and behavioral control files at task intake,
 * pinning them so candidate-branch edits cannot alter agent behavior (R-011).
 */

import { createHash } from "node:crypto";
import type { FactoryResult, TrustedBaseContext } from "@software-factory/core";
import {
  SetupContractSchema,
  createFactoryError,
} from "@software-factory/core";
import { err, ok } from "neverthrow";
import { parse as parseYaml } from "yaml";
import { createRestClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";

const CONTROL_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".factory/config.toml",
] as const;

export interface TrustedContextDeps {
  readonly credentialBroker: CredentialBroker;
}

export function createTrustedContextActivities(deps: TrustedContextDeps) {
  return {
    /**
     * Capture TrustedBaseContext at intake.
     * Pins the base SHA, loads setup contract and behavioral control files.
     */
    async captureTrustedContext(
      owner: string,
      repo: string,
      defaultBranch: string,
    ): Promise<FactoryResult<TrustedBaseContext>> {
      try {
        const token = await deps.credentialBroker.getToken("capability_scan");
        const client = createRestClient(token);

        // Step 1: Get HEAD SHA of default branch
        const { data: refData } = await client.git.getRef({
          owner,
          repo,
          ref: `heads/${defaultBranch}`,
        });
        const baseSha = refData.object.sha;

        // Step 2: Fetch .factory/setup.yml from pinned SHA
        const setupYml = await fetchFileFromRef(
          client,
          owner,
          repo,
          baseSha,
          ".factory/setup.yml",
        );
        let setupContract: TrustedBaseContext["setupContract"] = null;
        if (setupYml !== null) {
          const parsed = parseYaml(setupYml);
          const validated = SetupContractSchema.safeParse(parsed);
          if (validated.success) {
            setupContract = validated.data;
          }
        }

        // Step 3: Fetch behavioral control files and compute hashes
        const behavioralControlFiles: Record<string, string> = {};
        for (const filePath of CONTROL_FILES) {
          const content = await fetchFileFromRef(
            client,
            owner,
            repo,
            baseSha,
            filePath,
          );
          if (content !== null) {
            behavioralControlFiles[filePath] = content;
          }
        }

        // Step 4: Compute content hashes for verification
        const validationCommandSources: string[] = [];
        for (const [path, content] of Object.entries(behavioralControlFiles)) {
          const hash = createHash("sha256").update(content).digest("hex");
          validationCommandSources.push(`${path}:${hash}`);
        }

        const context: TrustedBaseContext = {
          baseSha,
          setupContract,
          policySnapshot: [],
          behavioralControlFiles,
          validationCommandSources,
          capturedAt: new Date().toISOString(),
        };

        return ok(context);
      } catch (error) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to capture TrustedBaseContext for ${owner}/${repo}: ${String(error)}`,
          ),
        );
      }
    },
  };
}

/**
 * Fetch a file from a specific ref (SHA) via the GitHub Contents API.
 * Returns null if the file doesn't exist (404).
 */
async function fetchFileFromRef(
  client: ReturnType<typeof createRestClient>,
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  try {
    const { data } = await client.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf8");
    }
    return null;
  } catch (e: unknown) {
    if (isNotFoundError(e)) {
      return null;
    }
    throw e;
  }
}

function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    (e as { status: unknown }).status === 404
  );
}
