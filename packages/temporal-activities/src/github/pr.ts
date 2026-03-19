/**
 * PR creation activities — creates a pull request from the candidate branch,
 * generates an evidence-linked PR body, and records the side-effect for idempotency.
 */

import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { CapabilitySnapshot, FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import type { EvidenceLocator } from "../evidence/locator.js";
import type { RiskCategorization } from "../evidence/risk-summary.js";
import { createRestClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { MutationSerializer } from "./rate-limiter.js";

// ─── Types ───

export interface CreatePRConfig {
  readonly owner: string;
  readonly repo: string;
  readonly candidateBranch: string;
  readonly baseBranch: string;
  readonly taskId: string;
  readonly objective: string;
  readonly evidenceLocator: EvidenceLocator;
  readonly riskSummary: RiskCategorization;
  readonly validationPassed: boolean;
  readonly headSha: string;
  readonly capabilitySnapshot: CapabilitySnapshot;
  readonly attemptNumber: number;
  readonly validationResult: ValidationSummaryForPR;
  readonly protectedSurfaceEdits?: readonly string[];
  readonly validatorControlFileEdits?: readonly ValidatorControlFileEditForPR[];
  readonly changedFiles?: readonly ChangedFileForPR[];
  readonly ownersImpacted?: readonly string[];
}

export interface ValidationSummaryForPR {
  readonly testResults: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
  readonly lintResults: {
    readonly errorCount: number;
    readonly warningCount: number;
    readonly details?: readonly {
      readonly file: string;
      readonly line: number;
      readonly rule: string;
      readonly severity: "error" | "warning";
      readonly message: string;
    }[];
  };
  readonly securityScanResults: {
    readonly criticalCount: number;
    readonly highCount: number;
    readonly vulnerabilities: readonly {
      readonly severity: string;
      readonly description: string;
      readonly file?: string;
      readonly line?: number;
      readonly id: string;
    }[];
  };
  readonly blastRadius: {
    readonly files: number;
    readonly packages: number;
  };
  readonly revertabilityClass: string;
}

export interface ValidatorControlFileEditForPR {
  readonly path: string;
  readonly category: string;
}

export interface ChangedFileForPR {
  readonly path: string;
  readonly riskLevel?: string;
}

export interface PRResult {
  readonly prNumber: number;
  readonly prUrl: string;
  readonly prNodeId: string;
  readonly headSha: string;
}

export interface PRUpdates {
  readonly title?: string;
  readonly body?: string;
}

export interface PRActivityDeps {
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

// ─── Idempotency Key ───

export function computePRIdempotencyKey(
  taskId: string,
  candidateBranch: string,
  baseBranch: string,
  headSha: string,
): string {
  return createHash("sha256")
    .update(
      `${taskId}\0create_pr\0${candidateBranch}\0${baseBranch}\0${headSha}`,
    )
    .digest("hex");
}

// ─── PR Body Generation ───

export function generatePRBody(config: CreatePRConfig, apiUrl: string): string {
  const { taskId, objective, riskSummary, validationResult } = config;
  const {
    testResults,
    lintResults,
    securityScanResults,
    blastRadius,
    revertabilityClass,
  } = validationResult;

  const mediumCount = securityScanResults.vulnerabilities.filter(
    (v) => v.severity === "medium",
  ).length;
  const lowCount = securityScanResults.vulnerabilities.filter(
    (v) => v.severity === "low",
  ).length;

  const lines: string[] = [];

  lines.push(`## Software Factory -- Task ${taskId}`);
  lines.push("");
  lines.push("### Objective");
  lines.push(objective);
  lines.push("");
  lines.push("### Risk Summary");
  lines.push("| Category | Count |");
  lines.push("|----------|-------|");
  lines.push(`| Hard Blockers | ${riskSummary.hardBlockers.length} |`);
  lines.push(`| Soft Concerns | ${riskSummary.softConcerns.length} |`);
  lines.push(
    `| Human Judgment | ${riskSummary.humanJudgmentRequired.length} |`,
  );
  lines.push(`| Informational | ${riskSummary.informational.length} |`);
  lines.push("");
  lines.push("### Validation Results");
  lines.push(
    `- Tests: ${testResults.passed} passed, ${testResults.failed} failed, ${testResults.skipped} skipped`,
  );
  lines.push(
    `- Lint: ${lintResults.errorCount} errors, ${lintResults.warningCount} warnings`,
  );
  lines.push(
    `- Security: ${securityScanResults.criticalCount} critical, ${securityScanResults.highCount} high, ${mediumCount} medium, ${lowCount} low`,
  );
  lines.push("");
  lines.push("### Blast Radius");
  lines.push(
    `${blastRadius.files} files changed, ${blastRadius.packages} packages affected`,
  );
  lines.push(`Revertability: ${revertabilityClass}`);
  lines.push("");
  lines.push("### Evidence");
  lines.push(`Full evidence packet: \`factory evidence ${taskId}\``);
  lines.push(`Evidence API: \`GET ${apiUrl}/api/tasks/${taskId}/evidence\``);

  // Changed files section
  const changedFiles = config.changedFiles ?? [];
  if (changedFiles.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push(`<summary>Files Changed (${changedFiles.length})</summary>`);
    lines.push("");
    for (const file of changedFiles) {
      const risk = file.riskLevel ? ` [${file.riskLevel}]` : "";
      lines.push(`- \`${file.path}\`${risk}`);
    }
    lines.push("");
    lines.push("</details>");
  }

  // Owners impacted section
  const owners = config.ownersImpacted ?? [];
  if (owners.length > 0) {
    lines.push("");
    lines.push("<details>");
    lines.push("<summary>Owners Impacted</summary>");
    lines.push("");
    for (const owner of owners) {
      lines.push(`- ${owner}`);
    }
    lines.push("");
    lines.push("</details>");
  }

  // Protected surface edits
  const protectedEdits = config.protectedSurfaceEdits ?? [];
  if (protectedEdits.length > 0) {
    lines.push("");
    lines.push("### Protected Surface Edits");
    for (const edit of protectedEdits) {
      lines.push(`- \`${edit}\``);
    }
  }

  // Validator control file edits
  const controlFileEdits = config.validatorControlFileEdits ?? [];
  if (controlFileEdits.length > 0) {
    lines.push("");
    lines.push("### Validator Control File Edits");
    lines.push("The agent modified files that influence validation behavior.");
    lines.push(
      "These edits are visible in the diff but did NOT affect validation results.",
    );
    for (const edit of controlFileEdits) {
      lines.push(`- \`${edit.path}\` (${edit.category})`);
    }
  }

  lines.push("");
  lines.push("---");
  lines.push(
    `*Generated by Software Factory • Attempt ${config.attemptNumber} • Base: \`${config.headSha.slice(0, 7)}\`*`,
  );

  return lines.join("\n");
}

// ─── PR Title ───

function buildPRTitle(objective: string): string {
  const maxLen = 60;
  const prefix = "factory: ";
  const available = maxLen - prefix.length;
  const truncated =
    objective.length > available
      ? `${objective.slice(0, available - 3)}...`
      : objective;
  return `${prefix}${truncated}`;
}

// ─── Activity Factory ───

function isGitHubError(e: unknown): e is { status: number; message: string } {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    typeof (e as { status: unknown }).status === "number"
  );
}

export function createPRActivities(deps: PRActivityDeps) {
  async function getClient(): Promise<Octokit> {
    const token = await deps.credentialBroker.getToken("pr_creation");
    return createRestClient(token);
  }

  return {
    async createPullRequest(
      config: CreatePRConfig,
      apiUrl: string,
    ): Promise<FactoryResult<PRResult>> {
      const idempotencyKey = computePRIdempotencyKey(
        config.taskId,
        config.candidateBranch,
        config.baseBranch,
        config.headSha,
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
          prNumber: payload.prNumber as number,
          prUrl: payload.prUrl as string,
          prNodeId: payload.prNodeId as string,
          headSha: config.headSha,
        });
      }

      // Record pending side-effect (if not already recorded as failed)
      if (!existing) {
        const recordResult = await deps.sideEffects.recordSideEffect(
          config.taskId,
          "create_pr",
          idempotencyKey,
          idempotencyKey.slice(0, 16),
        );
        if (recordResult.isErr()) {
          return err(recordResult.error);
        }
      }

      try {
        const client = await getClient();
        const title = buildPRTitle(config.objective);
        const body = generatePRBody(config, apiUrl);

        await deps.serializer.waitForSlot();
        const { data: pr } = await client.pulls.create({
          owner: config.owner,
          repo: config.repo,
          title,
          head: config.candidateBranch,
          base: config.baseBranch,
          body,
          draft: false,
        });

        const result: PRResult = {
          prNumber: pr.number,
          prUrl: pr.html_url,
          prNodeId: pr.node_id,
          headSha: config.headSha,
        };

        // Record completed side-effect
        await deps.sideEffects.completeSideEffect(idempotencyKey, {
          prNumber: result.prNumber,
          prUrl: result.prUrl,
          prNodeId: result.prNodeId,
        });

        return ok(result);
      } catch (e: unknown) {
        if (isGitHubError(e) && e.status === 422) {
          if (e.message.includes("already exists")) {
            // Find existing PR
            try {
              const client = await getClient();
              const { data: prs } = await client.pulls.list({
                owner: config.owner,
                repo: config.repo,
                head: `${config.owner}:${config.candidateBranch}`,
                base: config.baseBranch,
                state: "open",
              });

              if (prs.length > 0) {
                const existingPR = prs[0];
                const result: PRResult = {
                  prNumber: existingPR.number,
                  prUrl: existingPR.html_url,
                  prNodeId: existingPR.node_id,
                  headSha: config.headSha,
                };

                await deps.sideEffects.completeSideEffect(idempotencyKey, {
                  prNumber: result.prNumber,
                  prUrl: result.prUrl,
                  prNodeId: result.prNodeId,
                });

                return ok(result);
              }
            } catch {
              // Fall through to error handling
            }
          }

          if (e.message.includes("No commits between")) {
            await deps.sideEffects.failSideEffect(idempotencyKey, e.message);
            return err(
              createFactoryError(
                "evidence_invariant_fail",
                `No commits between base and head: ${e.message}`,
              ),
            );
          }
        }

        const errorMsg = e instanceof Error ? e.message : String(e);
        await deps.sideEffects.failSideEffect(idempotencyKey, errorMsg);
        return err(
          createFactoryError(
            "github_transient",
            `Failed to create PR: ${errorMsg}`,
          ),
        );
      }
    },

    async updatePullRequest(
      owner: string,
      repo: string,
      prNumber: number,
      updates: PRUpdates,
    ): Promise<FactoryResult<void>> {
      try {
        const client = await getClient();
        await deps.serializer.waitForSlot();
        await client.pulls.update({
          owner,
          repo,
          pull_number: prNumber,
          ...(updates.title && { title: updates.title }),
          ...(updates.body && { body: updates.body }),
        });
        return ok(undefined);
      } catch (e) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to update PR #${prNumber}: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },
  };
}

export { buildPRTitle };
