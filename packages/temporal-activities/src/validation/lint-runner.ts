/**
 * Lint runner — executes linter in sandbox and parses results.
 * The lint command comes from TrustedBaseContext (not workspace).
 */

import type {
  CommandRecord,
  FactoryResult,
  LintDetail,
  LintResults,
} from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import type { SandboxSupervisor } from "../sandbox/supervisor.js";

export interface LintRunnerConfig {
  readonly containerId: string;
  readonly lintCommand: string;
  readonly workingDir: string;
  readonly timeoutMs: number;
}

export interface LintRunResult {
  readonly lintResults: LintResults;
  readonly exitCode: number;
  readonly commandRecord: CommandRecord;
}

// ─── Lint output parsers ─────────────────────────────────────────────────────

export interface ParsedLint {
  readonly errorCount: number;
  readonly warningCount: number;
  readonly details: readonly LintDetail[];
}

/** Parse Biome JSON reporter output. */
export function parseBiomeJson(output: string): ParsedLint | null {
  try {
    const data = JSON.parse(output);
    if (!data?.diagnostics && !Array.isArray(data)) return null;
    const diagnostics: unknown[] = data.diagnostics ?? data;
    if (!Array.isArray(diagnostics)) return null;

    let errors = 0;
    let warnings = 0;
    const details: LintDetail[] = [];

    for (const d of diagnostics) {
      const diag = d as Record<string, unknown>;
      const severity = String(diag.severity ?? "error").toLowerCase();
      const isError = severity === "error";
      if (isError) errors++;
      else warnings++;

      const location = diag.location as Record<string, unknown> | undefined;
      details.push({
        file: String(location?.path ?? diag.file ?? "unknown"),
        line: Number(
          (location?.span as Record<string, unknown>)?.start ?? diag.line ?? 0,
        ),
        column: Number(
          (location?.span as Record<string, unknown>)?.column ?? 0,
        ),
        rule: String(diag.category ?? diag.rule ?? "unknown"),
        severity: isError ? "error" : "warning",
        message: String(diag.message ?? diag.description ?? ""),
      });
    }

    return { errorCount: errors, warningCount: warnings, details };
  } catch {
    return null;
  }
}

/** Parse ESLint JSON reporter output. */
export function parseEslintJson(output: string): ParsedLint | null {
  try {
    const data = JSON.parse(output);
    if (!Array.isArray(data)) return null;

    let errors = 0;
    let warnings = 0;
    const details: LintDetail[] = [];

    for (const fileResult of data) {
      const fr = fileResult as Record<string, unknown>;
      const filePath = String(fr.filePath ?? "unknown");
      const messages = fr.messages as Array<Record<string, unknown>>;
      if (!Array.isArray(messages)) continue;

      for (const msg of messages) {
        const severity = Number(msg.severity ?? 1);
        const isError = severity === 2;
        if (isError) errors++;
        else warnings++;

        details.push({
          file: filePath,
          line: Number(msg.line ?? 0),
          column: Number(msg.column ?? 0),
          rule: String(msg.ruleId ?? "unknown"),
          severity: isError ? "error" : "warning",
          message: String(msg.message ?? ""),
        });
      }
    }

    return { errorCount: errors, warningCount: warnings, details };
  } catch {
    return null;
  }
}

/** Fallback: count "error" and "warning" patterns in text output. */
export function parseLintFallback(output: string): ParsedLint {
  const errorMatches = output.match(/\berror\b/gi);
  const warningMatches = output.match(/\bwarning\b/gi);
  return {
    errorCount: errorMatches?.length ?? 0,
    warningCount: warningMatches?.length ?? 0,
    details: [],
  };
}

/** Try all parsers in priority order. */
export function parseLintOutput(stdout: string, stderr: string): ParsedLint {
  const combined = `${stdout}\n${stderr}`;

  // Try JSON parsers first
  const biome = parseBiomeJson(stdout);
  if (biome) return biome;

  const eslint = parseEslintJson(stdout);
  if (eslint) return eslint;

  return parseLintFallback(combined);
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runLinter(
  config: LintRunnerConfig,
  sandbox: SandboxSupervisor,
): Promise<FactoryResult<LintRunResult>> {
  const instance = {
    containerId: config.containerId,
    phase: "execution" as const,
    labels: {},
  };

  const execResult = await sandbox.execCommand(
    instance,
    ["sh", "-c", config.lintCommand],
    { workingDir: config.workingDir, timeoutMs: config.timeoutMs },
  );

  if (execResult.isErr()) {
    return err(createFactoryError("sandbox_failure", execResult.error.message));
  }

  const { exitCode, stdout, stderr, durationMs } = execResult.value;
  const parsed = parseLintOutput(stdout, stderr);

  // If exit code 0 but parser found errors, trust exit code
  const lintResults: LintResults =
    exitCode === 0
      ? { errorCount: 0, warningCount: parsed.warningCount, details: [] }
      : {
          errorCount: parsed.errorCount || 1,
          warningCount: parsed.warningCount,
          details: [...parsed.details],
        };

  const commandRecord: CommandRecord = {
    command: config.lintCommand,
    exitCode,
    durationMs,
    output: `${stdout}\n${stderr}`.slice(0, 10_000),
  };

  return ok({ lintResults, exitCode, commandRecord });
}
