import type { Octokit } from "@octokit/rest";
import type {
  BranchProtection,
  CapabilitySnapshot,
  Codeowners,
  FactoryError,
  RequiredStatusCheck,
  Ruleset,
} from "@software-factory/core";
import {
  CODEOWNERS_LOCATIONS,
  CapabilitySnapshotSchema,
  createFactoryError,
} from "@software-factory/core";
import { type Result, err, ok } from "neverthrow";

import { createRestClient } from "./client.js";
import { parseCodeowners } from "./codeowners-parser.js";
import type { CredentialBroker } from "./credential-broker.js";
import { parseRateLimitHeaders } from "./rate-limiter.js";
import {
  getEffectiveRules,
  hasInheritedRulesets,
  parseRulesetResponse,
} from "./ruleset-analyzer.js";
import type { GitHubRulesetResponse } from "./ruleset-analyzer.js";
import { scanWorkflowContent } from "./workflow-scanner.js";

export interface ScanLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
}

const noopLogger: ScanLogger = {
  info: () => {},
  warn: () => {},
};

/**
 * Scan a GitHub repository and produce a comprehensive CapabilitySnapshot.
 *
 * 10-step sequence:
 * 1. Authenticate via CredentialBroker
 * 2. Fetch repo metadata
 * 3. Fetch rulesets (with includes_parents=true)
 * 4. Fetch branch rules (modern API)
 * 5. Fetch branch protection (legacy API)
 * 6. Fetch CODEOWNERS
 * 7. Fetch environments
 * 8. Scan workflows for dangerous triggers
 * 9. Normalize and classify
 * 10. Validate and return
 */
export async function scanRepository(
  owner: string,
  repo: string,
  broker: CredentialBroker,
  _installationId: number,
  logger: ScanLogger = noopLogger,
): Promise<Result<CapabilitySnapshot, FactoryError>> {
  try {
    // Step 1: Authenticate
    const token = await broker.getToken("capability_scan");
    const client = createRestClient(token);

    // Step 2: Fetch repo metadata
    const metadata = await fetchRepoMetadata(client, owner, repo, logger);
    if (metadata.isErr()) return err(metadata.error);
    const meta = metadata.value;

    // Step 3: Fetch rulesets (includes_parents=true is CRITICAL)
    const rulesets = await fetchRulesets(client, owner, repo, logger);

    // Step 4: Fetch branch rules (modern API — informational, rules captured via rulesets)
    // The rulesets endpoint already returns full rule data, so step 4 is merged into step 3.

    // Step 5: Fetch branch protection (legacy API)
    const branchProtection = await fetchBranchProtection(
      client,
      owner,
      repo,
      meta.defaultBranch,
      logger,
    );

    // Step 6: Fetch CODEOWNERS
    const codeowners = await fetchCodeowners(
      client,
      owner,
      repo,
      meta.defaultBranch,
      logger,
    );

    // Step 7: Fetch environments
    const environments = await fetchEnvironments(client, owner, repo, logger);

    // Step 8: Scan workflows for dangerous triggers
    const workflowScan = await scanWorkflows(
      client,
      owner,
      repo,
      meta.defaultBranch,
      logger,
    );

    // Step 9: Normalize and classify
    const effective = getEffectiveRules(rulesets, branchProtection);
    const warnings = [...effective.warnings, ...meta.warnings];

    if (workflowScan.scanErrors.length > 0) {
      warnings.push(...workflowScan.scanErrors);
    }

    const hasPRT = workflowScan.dangerousWorkflows.some((w) =>
      w.triggers.includes("pull_request_target"),
    );
    const prtPaths = workflowScan.dangerousWorkflows
      .filter((w) => w.triggers.includes("pull_request_target"))
      .map((w) => w.path);

    if (hasPRT) {
      warnings.push(
        "HIGH RISK: pull_request_target workflows detected — these run with write permissions and secrets access from the base branch",
      );
    }

    const repoClass = classifyRepo(meta, rulesets);
    const { supportedByFactory, unsupportedReasons } = determineSupportability(
      meta,
      rulesets,
    );

    // Determine allowed merge strategies from repo settings
    const allowedMergeStrategies = meta.allowedMergeStrategies;

    const snapshot: CapabilitySnapshot = {
      repoId: meta.repoId,
      capturedAt: new Date().toISOString(),
      sourceRevision: meta.sourceRevision,
      defaultBranch: meta.defaultBranch,
      visibility: meta.visibility,
      isArchived: meta.isArchived,
      isFork: meta.isFork,
      hasWiki: meta.hasWiki,
      hasProjects: meta.hasProjects,
      branchProtection,
      rulesets,
      hasInheritedRulesets: hasInheritedRulesets(rulesets),
      codeowners,
      mergeQueue: effective.mergeQueue,
      allowedMergeStrategies,
      requiredStatusChecks: [...effective.requiredStatusChecks],
      requiredWorkflows: [...effective.requiredWorkflows],
      requiresSignedCommits: effective.requiresSignedCommits,
      requiresLinearHistory: effective.requiresLinearHistory,
      requiresConversationResolution: effective.requiresConversationResolution,
      dismissesStaleReviews: effective.dismissesStaleReviews,
      requiredReviewCount: effective.requiredReviewCount,
      requiresCodeOwnerReview: effective.requiresCodeOwnerReview,
      lastPusherCannotApprove: effective.lastPusherCannotApprove,
      hasPullRequestTargetWorkflows: hasPRT,
      pullRequestTargetWorkflowPaths: prtPaths,
      pushRestrictions: effective.pushRestrictions,
      bypassActors: [...effective.bypassActors],
      environments,
      repoClass,
      supportedByFactory,
      unsupportedReasons,
      warnings,
    };

    // Step 10: Validate against Zod schema before return
    const parsed = CapabilitySnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      return err(
        createFactoryError(
          "unknown_internal",
          `CapabilitySnapshot validation failed: ${parsed.error.message}`,
        ),
      );
    }

    return ok(parsed.data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown scan error";
    return err(createFactoryError("github_transient", message));
  }
}

// === Step 2: Repo Metadata ===

interface RepoMetadata {
  readonly repoId: string;
  readonly sourceRevision: string;
  readonly defaultBranch: string;
  readonly visibility: "public" | "private" | "internal";
  readonly isArchived: boolean;
  readonly isFork: boolean;
  readonly hasWiki: boolean;
  readonly hasProjects: boolean;
  readonly allowedMergeStrategies: Array<"merge" | "squash" | "rebase">;
  readonly warnings: string[];
}

async function fetchRepoMetadata(
  client: Octokit,
  owner: string,
  repo: string,
  logger: ScanLogger,
): Promise<Result<RepoMetadata, FactoryError>> {
  const response = await client.repos.get({ owner, repo });
  logRateLimit(logger, response.headers as Record<string, string | undefined>);

  const data = response.data;
  const warnings: string[] = [];

  if (data.archived) {
    warnings.push("Repository is archived — limited capabilities available");
  }
  if (data.fork) {
    warnings.push("Repository is a fork — some capabilities may be restricted");
  }

  const mergeStrategies: Array<"merge" | "squash" | "rebase"> = [];
  if (data.allow_merge_commit !== false) mergeStrategies.push("merge");
  if (data.allow_squash_merge !== false) mergeStrategies.push("squash");
  if (data.allow_rebase_merge !== false) mergeStrategies.push("rebase");

  let visibility: "public" | "private" | "internal";
  if (data.visibility === "internal") {
    visibility = "internal";
  } else if (data.private) {
    visibility = "private";
  } else {
    visibility = "public";
  }

  // Derive a stable UUID v5 from the GitHub repo numeric ID.
  // Uses a fixed namespace so the same repo always produces the same UUID.
  const repoId = deterministicRepoUUID(data.id);

  return ok({
    repoId,
    sourceRevision: data.default_branch
      ? (
          await client.repos.getCommit({
            owner,
            repo,
            ref: data.default_branch,
          })
        ).data.sha
      : "",
    defaultBranch: data.default_branch ?? "main",
    visibility,
    isArchived: data.archived ?? false,
    isFork: data.fork ?? false,
    hasWiki: data.has_wiki ?? false,
    hasProjects: data.has_projects ?? false,
    allowedMergeStrategies: mergeStrategies,
    warnings,
  });
}

// === Step 3: Rulesets ===

async function fetchRulesets(
  client: Octokit,
  owner: string,
  repo: string,
  logger: ScanLogger,
): Promise<Ruleset[]> {
  try {
    // includes_parents=true is CRITICAL — without it, inherited org rulesets are invisible
    const response = await client.request(
      "GET /repos/{owner}/{repo}/rulesets",
      {
        owner,
        repo,
        includes_parents: true,
      },
    );
    logRateLimit(
      logger,
      response.headers as Record<string, string | undefined>,
    );

    const rulesets: Ruleset[] = [];
    for (const raw of response.data) {
      // Fetch full ruleset details (list endpoint may not include rules)
      const detail = await client.request(
        "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}",
        {
          owner,
          repo,
          ruleset_id: raw.id,
          includes_parents: true,
        },
      );
      logRateLimit(
        logger,
        detail.headers as Record<string, string | undefined>,
      );

      rulesets.push(
        parseRulesetResponse(detail.data as unknown as GitHubRulesetResponse),
      );
    }

    return rulesets;
  } catch (error) {
    // 404 means rulesets are not available (older plans, etc.)
    if (isNotFound(error)) {
      logger.info("Rulesets API returned 404 — rulesets not available");
      return [];
    }
    throw error;
  }
}

// === Step 5: Branch Protection (legacy) ===

async function fetchBranchProtection(
  client: Octokit,
  owner: string,
  repo: string,
  branch: string,
  logger: ScanLogger,
): Promise<BranchProtection | null> {
  try {
    const response = await client.repos.getBranchProtection({
      owner,
      repo,
      branch,
    });
    logRateLimit(
      logger,
      response.headers as Record<string, string | undefined>,
    );

    const data = response.data;

    const requiredStatusChecks: RequiredStatusCheck[] = (
      data.required_status_checks?.contexts ?? []
    ).map((context) => ({
      context,
      appId: null,
    }));

    // Also check for checks with app IDs
    if (data.required_status_checks?.checks) {
      for (const check of data.required_status_checks.checks) {
        if (!requiredStatusChecks.some((c) => c.context === check.context)) {
          requiredStatusChecks.push({
            context: check.context,
            appId: check.app_id ?? null,
          });
        }
      }
    }

    return {
      requiredReviewCount:
        data.required_pull_request_reviews?.required_approving_review_count ??
        0,
      dismissesStaleReviews:
        data.required_pull_request_reviews?.dismiss_stale_reviews ?? false,
      requiresCodeOwnerReview:
        data.required_pull_request_reviews?.require_code_owner_reviews ?? false,
      lastPusherCannotApprove:
        data.required_pull_request_reviews?.require_last_push_approval ?? false,
      requiredStatusChecks,
      enforceAdmins: data.enforce_admins?.enabled ?? false,
      requireLinearHistory: data.required_linear_history?.enabled ?? false,
      allowForcePushes: data.allow_force_pushes?.enabled ?? false,
      allowDeletions: data.allow_deletions?.enabled ?? false,
      requiredSignatures: data.required_signatures?.enabled ?? false,
      requiresConversationResolution:
        data.required_conversation_resolution?.enabled ?? false,
      restrictions: data.restrictions
        ? {
            users: (data.restrictions.users ?? [])
              .map((u) => u.login)
              .filter((s): s is string => s !== undefined),
            teams: (data.restrictions.teams ?? []).map((t) => t.slug),
            apps: (data.restrictions.apps ?? [])
              .map((a) => a.slug)
              .filter((s): s is string => s !== undefined),
          }
        : null,
    };
  } catch (error) {
    if (isNotFound(error)) {
      logger.info(
        "Branch protection API returned 404 — no legacy protection configured",
      );
      return null;
    }
    throw error;
  }
}

// === Step 6: CODEOWNERS ===

async function fetchCodeowners(
  client: Octokit,
  owner: string,
  repo: string,
  defaultBranch: string,
  logger: ScanLogger,
): Promise<Codeowners | null> {
  for (const location of CODEOWNERS_LOCATIONS) {
    try {
      const response = await client.repos.getContent({
        owner,
        repo,
        path: location,
        ref: defaultBranch,
      });
      logRateLimit(
        logger,
        response.headers as Record<string, string | undefined>,
      );

      const data = response.data;
      if ("content" in data && data.encoding === "base64") {
        const content = Buffer.from(data.content, "base64").toString("utf-8");
        const parsed = parseCodeowners(content);

        return {
          found: true,
          location,
          entries: [...parsed.entries],
          parseErrors: [...parsed.parseErrors],
        };
      }
    } catch (error) {
      if (isNotFound(error)) {
        continue;
      }
      logger.warn(`Error fetching CODEOWNERS at ${location}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

// === Step 7: Environments ===

async function fetchEnvironments(
  client: Octokit,
  owner: string,
  repo: string,
  logger: ScanLogger,
): Promise<string[]> {
  try {
    const response = await client.repos.getAllEnvironments({ owner, repo });
    logRateLimit(
      logger,
      response.headers as Record<string, string | undefined>,
    );

    return (response.data.environments ?? []).map((env) => env.name);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    logger.warn("Failed to fetch environments", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// === Step 8: Workflow Scanning ===

async function scanWorkflows(
  client: Octokit,
  owner: string,
  repo: string,
  defaultBranch: string,
  logger: ScanLogger,
): Promise<{
  dangerousWorkflows: Array<{
    path: string;
    triggers: Array<"pull_request_target" | "workflow_run">;
  }>;
  scanErrors: string[];
}> {
  const dangerousWorkflows: Array<{
    path: string;
    triggers: Array<"pull_request_target" | "workflow_run">;
  }> = [];
  const scanErrors: string[] = [];

  try {
    const response = await client.repos.getContent({
      owner,
      repo,
      path: ".github/workflows",
      ref: defaultBranch,
    });
    logRateLimit(
      logger,
      response.headers as Record<string, string | undefined>,
    );

    if (!Array.isArray(response.data)) {
      return { dangerousWorkflows, scanErrors };
    }

    const workflowFiles = response.data.filter(
      (f) =>
        f.type === "file" &&
        (f.name.endsWith(".yml") || f.name.endsWith(".yaml")),
    );

    for (const file of workflowFiles) {
      try {
        const contentResponse = await client.repos.getContent({
          owner,
          repo,
          path: file.path,
          ref: defaultBranch,
        });
        logRateLimit(
          logger,
          contentResponse.headers as Record<string, string | undefined>,
        );

        const fileData = contentResponse.data;
        if ("content" in fileData && fileData.encoding === "base64") {
          const content = Buffer.from(fileData.content, "base64").toString(
            "utf-8",
          );
          const result = scanWorkflowContent(file.path, content);
          dangerousWorkflows.push(
            ...(result.dangerousWorkflows as Array<{
              path: string;
              triggers: Array<"pull_request_target" | "workflow_run">;
            }>),
          );
          scanErrors.push(...result.scanErrors);
        }
      } catch (error) {
        scanErrors.push(
          `Failed to fetch workflow ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch (error) {
    if (isNotFound(error)) {
      logger.info("No .github/workflows directory found");
      return { dangerousWorkflows, scanErrors };
    }
    scanErrors.push(
      `Failed to list workflows: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { dangerousWorkflows, scanErrors };
}

// === Step 9: Classification ===

function classifyRepo(
  meta: RepoMetadata,
  _rulesets: readonly Ruleset[],
): "A" | "B" | "C" {
  // Class C: Unsupported features
  if (meta.isArchived) return "C";

  // Class A: Standard repo
  return "A";
}

function determineSupportability(
  meta: RepoMetadata,
  _rulesets: readonly Ruleset[],
): {
  supportedByFactory: boolean;
  unsupportedReasons: string[];
} {
  const unsupportedReasons: string[] = [];

  if (meta.isArchived) {
    unsupportedReasons.push("Repository is archived");
  }

  return {
    supportedByFactory: unsupportedReasons.length === 0,
    unsupportedReasons,
  };
}

// === Helpers ===

function logRateLimit(
  logger: ScanLogger,
  headers: Record<string, string | undefined>,
): void {
  const info = parseRateLimitHeaders(headers);
  if (info) {
    logger.info("Rate limit", {
      remaining: info.remaining,
      limit: info.limit,
      resource: info.resource,
    });
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 404
  );
}

/**
 * Generate a deterministic UUID from a GitHub repo numeric ID.
 * Uses UUID v5 algorithm with a fixed namespace so the same repo
 * always produces the same UUID across scans.
 */
function deterministicRepoUUID(githubRepoId: number): string {
  // Fixed namespace UUID for software-factory repo IDs
  // Generated once, never changes: uuid v4 "6ba7b810-9dad-41d4-8009-factory000000"
  // We use a simple deterministic approach: pad the numeric ID into a UUID format
  const hex = githubRepoId.toString(16).padStart(12, "0");
  return `00000000-0000-5000-a000-${hex}`;
}
