/**
 * Factory check run management — creates check runs with validation results,
 * annotations (batched at 50 per update), and optional SARIF upload.
 */

import { createHash } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import type { FactoryResult } from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import { createRestClient } from "./client.js";
import type { CredentialBroker } from "./credential-broker.js";
import type { SideEffectOps } from "./pr.js";
import type { MutationSerializer } from "./rate-limiter.js";

// ─── Types ───

export interface CheckRunConfig {
  readonly owner: string;
  readonly repo: string;
  readonly headSha: string;
  readonly taskId: string;
  readonly validationPassed: boolean;
  readonly testResults: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
  readonly lintResults: {
    readonly errorCount: number;
    readonly warningCount: number;
    readonly details?: readonly LintAnnotationSource[];
  };
  readonly securityScanResults: {
    readonly criticalCount: number;
    readonly highCount: number;
    readonly vulnerabilities: readonly SecurityAnnotationSource[];
  };
  readonly blastRadius: {
    readonly files: number;
    readonly packages: number;
  };
  readonly protectedEdits: readonly ProtectedEditSource[];
  readonly sarifOutput?: string;
  readonly evidenceUrl?: string;
}

export interface LintAnnotationSource {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface SecurityAnnotationSource {
  readonly severity: string;
  readonly description: string;
  readonly file?: string;
  readonly line?: number;
  readonly id: string;
}

export interface ProtectedEditSource {
  readonly filePath: string;
  readonly protectionClass: string;
}

export interface CheckRunAnnotation {
  readonly path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly annotation_level: "notice" | "warning" | "failure";
  readonly message: string;
  readonly title?: string;
}

export interface CheckRunResult {
  readonly checkRunId: number;
  readonly checkRunUrl: string;
}

export interface CheckRunUpdates {
  readonly conclusion?: "success" | "failure" | "neutral";
  readonly output?: {
    readonly title: string;
    readonly summary: string;
  };
}

export interface CheckRunActivityDeps {
  readonly credentialBroker: CredentialBroker;
  readonly serializer: MutationSerializer;
  readonly sideEffects: SideEffectOps;
}

// ─── Constants ───

const MAX_ANNOTATIONS_PER_UPDATE = 50;
const CHECK_RUN_NAME = "Software Factory Validation";

// ─── Idempotency ───

export function computeCheckRunIdempotencyKey(
  taskId: string,
  headSha: string,
): string {
  return createHash("sha256")
    .update(`${taskId}\0create_check_run\0${headSha}`)
    .digest("hex");
}

// ─── Conclusion Mapping ───

export function computeConclusion(
  config: CheckRunConfig,
): "success" | "failure" | "neutral" {
  if (
    config.testResults.failed > 0 ||
    config.securityScanResults.criticalCount > 0 ||
    config.lintResults.errorCount > 0
  ) {
    return "failure";
  }
  if (
    config.lintResults.warningCount > 0 ||
    config.securityScanResults.highCount > 0
  ) {
    return "neutral";
  }
  return "success";
}

// ─── Summary Generation ───

export function generateCheckRunSummary(config: CheckRunConfig): string {
  const lines: string[] = [];

  lines.push("### Tests");
  lines.push(
    `${config.testResults.passed} passed | ${config.testResults.failed} failed | ${config.testResults.skipped} skipped`,
  );
  lines.push("");
  lines.push("### Lint");
  lines.push(
    `${config.lintResults.errorCount} errors | ${config.lintResults.warningCount} warnings`,
  );
  lines.push("");
  lines.push("### Security");

  const vulns = config.securityScanResults;
  const mediumCount = vulns.vulnerabilities.filter(
    (v) => v.severity === "medium",
  ).length;
  const lowCount = vulns.vulnerabilities.filter(
    (v) => v.severity === "low",
  ).length;
  lines.push(
    `${vulns.criticalCount} critical | ${vulns.highCount} high | ${mediumCount} medium | ${lowCount} low`,
  );
  lines.push("");
  lines.push("### Blast Radius");
  lines.push(
    `${config.blastRadius.files} files changed | ${config.blastRadius.packages} packages affected`,
  );

  if (config.evidenceUrl) {
    lines.push("");
    lines.push(`[View full evidence](${config.evidenceUrl})`);
  }

  return lines.join("\n");
}

// ─── Annotations ───

export function buildAnnotations(config: CheckRunConfig): CheckRunAnnotation[] {
  const annotations: CheckRunAnnotation[] = [];

  // Security findings
  for (const vuln of config.securityScanResults.vulnerabilities) {
    if (vuln.file) {
      annotations.push({
        path: vuln.file,
        start_line: vuln.line ?? 1,
        end_line: vuln.line ?? 1,
        annotation_level:
          vuln.severity === "critical" || vuln.severity === "high"
            ? "failure"
            : "warning",
        message: vuln.description,
        title: `Security: ${vuln.id} (${vuln.severity})`,
      });
    }
  }

  // Lint errors
  if (config.lintResults.details) {
    for (const lint of config.lintResults.details) {
      annotations.push({
        path: lint.file,
        start_line: lint.line,
        end_line: lint.line,
        annotation_level: lint.severity === "error" ? "failure" : "warning",
        message: `${lint.rule}: ${lint.message}`,
        title: `Lint: ${lint.rule}`,
      });
    }
  }

  // Protected edits
  for (const edit of config.protectedEdits) {
    annotations.push({
      path: edit.filePath,
      start_line: 1,
      end_line: 1,
      annotation_level: "notice",
      message: `Protected surface edit (${edit.protectionClass})`,
      title: "Protected Surface Edit",
    });
  }

  return annotations;
}

// ─── Activity Factory ───

export function createCheckRunActivities(deps: CheckRunActivityDeps) {
  async function getClient(): Promise<Octokit> {
    const token = await deps.credentialBroker.getToken("implementation");
    return createRestClient(token);
  }

  return {
    async createFactoryCheckRun(
      config: CheckRunConfig,
    ): Promise<FactoryResult<CheckRunResult>> {
      const idempotencyKey = computeCheckRunIdempotencyKey(
        config.taskId,
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
          checkRunId: payload.checkRunId as number,
          checkRunUrl: payload.checkRunUrl as string,
        });
      }

      // Record pending side-effect
      if (!existing) {
        const recordResult = await deps.sideEffects.recordSideEffect(
          config.taskId,
          "create_check_run",
          idempotencyKey,
          idempotencyKey.slice(0, 16),
        );
        if (recordResult.isErr()) {
          return err(recordResult.error);
        }
      }

      try {
        const client = await getClient();
        const conclusion = computeConclusion(config);
        const summary = generateCheckRunSummary(config);
        const allAnnotations = buildAnnotations(config);
        const title = config.validationPassed
          ? "Factory Validation: All Checks Passed"
          : "Factory Validation: Issues Found";

        // First batch of annotations (max 50)
        const firstBatch = allAnnotations.slice(0, MAX_ANNOTATIONS_PER_UPDATE);

        await deps.serializer.waitForSlot();
        const { data: checkRun } = await client.checks.create({
          owner: config.owner,
          repo: config.repo,
          name: CHECK_RUN_NAME,
          head_sha: config.headSha,
          status: "completed",
          conclusion,
          output: {
            title,
            summary,
            annotations: firstBatch,
          },
        });

        // Submit remaining annotations in batches
        for (
          let i = MAX_ANNOTATIONS_PER_UPDATE;
          i < allAnnotations.length;
          i += MAX_ANNOTATIONS_PER_UPDATE
        ) {
          const batch = allAnnotations.slice(i, i + MAX_ANNOTATIONS_PER_UPDATE);
          await deps.serializer.waitForSlot();
          await client.checks.update({
            owner: config.owner,
            repo: config.repo,
            check_run_id: checkRun.id,
            output: {
              title,
              summary,
              annotations: batch,
            },
          });
        }

        const result: CheckRunResult = {
          checkRunId: checkRun.id,
          checkRunUrl: checkRun.html_url ?? "",
        };

        // Complete side-effect
        await deps.sideEffects.completeSideEffect(idempotencyKey, {
          checkRunId: result.checkRunId,
          checkRunUrl: result.checkRunUrl,
        });

        return ok(result);
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        await deps.sideEffects.failSideEffect(idempotencyKey, errorMsg);
        return err(
          createFactoryError(
            "github_transient",
            `Failed to create check run: ${errorMsg}`,
          ),
        );
      }
    },

    async updateCheckRun(
      owner: string,
      repo: string,
      checkRunId: number,
      updates: CheckRunUpdates,
    ): Promise<FactoryResult<void>> {
      try {
        const client = await getClient();
        await deps.serializer.waitForSlot();
        await client.checks.update({
          owner,
          repo,
          check_run_id: checkRunId,
          ...(updates.conclusion && { conclusion: updates.conclusion }),
          ...(updates.output && { output: updates.output }),
        });
        return ok(undefined);
      } catch (e) {
        return err(
          createFactoryError(
            "github_transient",
            `Failed to update check run: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
      }
    },

    async uploadSarif(
      owner: string,
      repo: string,
      commitSha: string,
      sarifContent: string,
    ): Promise<FactoryResult<void>> {
      try {
        const client = await getClient();
        const compressed = Buffer.from(sarifContent).toString("base64");
        await deps.serializer.waitForSlot();
        await client.request(
          "POST /repos/{owner}/{repo}/code-scanning/sarifs",
          {
            owner,
            repo,
            commit_sha: commitSha,
            ref: "refs/heads/main",
            sarif: compressed,
          },
        );
        return ok(undefined);
      } catch {
        // Best-effort — silently fail if permissions are missing
        return ok(undefined);
      }
    },
  };
}
