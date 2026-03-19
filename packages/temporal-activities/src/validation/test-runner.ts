/**
 * Test runner — executes project tests in sandbox and parses results.
 * The test command comes from TrustedBaseContext (not workspace).
 * Exit code is the source of truth for pass/fail.
 */

import type {
  CommandRecord,
  FactoryResult,
  TestDetail,
  TestResults,
} from "@software-factory/core";
import { createFactoryError } from "@software-factory/core";
import { err, ok } from "neverthrow";
import type { SandboxSupervisor } from "../sandbox/supervisor.js";

export interface TestRunnerConfig {
  readonly containerId: string;
  readonly testCommand: string;
  readonly workingDir: string;
  readonly timeoutMs: number;
  readonly runtimeSecrets?: Readonly<Record<string, string>>;
}

export interface TestRunResult {
  readonly testResults: TestResults;
  readonly exitCode: number;
  readonly commandRecord: CommandRecord;
}

// ─── Test output parsers ─────────────────────────────────────────────────────

export interface ParsedCounts {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly details: readonly TestDetail[];
}

const EMPTY_COUNTS: ParsedCounts = {
  passed: 0,
  failed: 0,
  skipped: 0,
  details: [],
};

/** Parse Vitest / Jest summary line: "Tests:  3 passed, 1 failed, 2 skipped" */
export function parseVitestJest(output: string): ParsedCounts | null {
  const match = output.match(
    /Tests:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?/i,
  );
  if (!match) return null;
  return {
    passed: Number(match[1] ?? 0),
    failed: Number(match[2] ?? 0),
    skipped: Number(match[3] ?? 0),
    details: [],
  };
}

/** Parse pytest summary: "5 passed, 2 failed, 1 skipped" */
export function parsePytest(output: string): ParsedCounts | null {
  // Verify it looks like pytest (has "N passed" or "N failed" keyword)
  if (!/\d+\s+(?:passed|failed)/i.test(output)) return null;

  const passedMatch = output.match(/(\d+)\s+passed/i);
  const failedMatch = output.match(/(\d+)\s+failed/i);
  const skippedMatch = output.match(/(\d+)\s+skipped/i);

  if (!passedMatch && !failedMatch) return null;

  return {
    passed: passedMatch ? Number(passedMatch[1]) : 0,
    failed: failedMatch ? Number(failedMatch[1]) : 0,
    skipped: skippedMatch ? Number(skippedMatch[1]) : 0,
    details: [],
  };
}

/** Parse Go test output: "ok  package  0.123s" / "FAIL  package" */
export function parseGoTest(output: string): ParsedCounts | null {
  const okMatches = output.match(/^ok\s+/gm);
  const failMatches = output.match(/^FAIL\s+/gm);
  if (!okMatches && !failMatches) return null;
  const skipMatches = output.match(/^---\s+SKIP/gm);
  return {
    passed: okMatches?.length ?? 0,
    failed: failMatches?.length ?? 0,
    skipped: skipMatches?.length ?? 0,
    details: [],
  };
}

/** Parse Rust test output: "test result: ok. N passed; M failed; K ignored" */
export function parseRustTest(output: string): ParsedCounts | null {
  const match = output.match(
    /test result:.*?(\d+)\s+passed;\s+(\d+)\s+failed;\s+(\d+)\s+ignored/,
  );
  if (!match) return null;
  return {
    passed: Number(match[1]),
    failed: Number(match[2]),
    skipped: Number(match[3]),
    details: [],
  };
}

/** Parse JUnit XML output for test details. */
export function parseJunitXml(xml: string): ParsedCounts | null {
  // Simple regex-based parser — not a full XML parser
  const testsuiteMatch = xml.match(
    /<testsuite[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"/,
  );
  if (!testsuiteMatch) return null;

  const total = Number(testsuiteMatch[1]);
  const failures = Number(testsuiteMatch[2]);
  const skippedMatch = xml.match(/<testsuite[^>]*\bskipped="(\d+)"/);
  const skipped = skippedMatch ? Number(skippedMatch[1]) : 0;

  const details: TestDetail[] = [];
  const testcaseRegex =
    /<testcase\s+[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g;
  let tcMatch: RegExpExecArray | null = testcaseRegex.exec(xml);
  while (tcMatch !== null) {
    const name = tcMatch[1];
    const body = tcMatch[2];
    if (/<failure/.test(body)) {
      const errMsg =
        body.match(/<failure[^>]*message="([^"]*)"/)?.[1] ?? "test failed";
      details.push({ name, status: "failed", errorMessage: errMsg });
    } else if (/<skipped/.test(body)) {
      details.push({ name, status: "skipped" });
    } else {
      details.push({ name, status: "passed" });
    }
    tcMatch = testcaseRegex.exec(xml);
  }

  return {
    passed: total - failures - skipped,
    failed: failures,
    skipped,
    details,
  };
}

/** Try all parsers in priority order. */
export function parseTestOutput(stdout: string, stderr: string): ParsedCounts {
  const combined = `${stdout}\n${stderr}`;

  // Try JUnit XML first (most structured)
  const junit = parseJunitXml(combined);
  if (junit) return junit;

  // Try framework-specific parsers
  const vitest = parseVitestJest(combined);
  if (vitest && (vitest.passed > 0 || vitest.failed > 0)) return vitest;

  const rust = parseRustTest(combined);
  if (rust) return rust;

  const go = parseGoTest(combined);
  if (go) return go;

  const pytest = parsePytest(combined);
  if (pytest && (pytest.passed > 0 || pytest.failed > 0)) return pytest;

  return EMPTY_COUNTS;
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runTests(
  config: TestRunnerConfig,
  sandbox: SandboxSupervisor,
): Promise<FactoryResult<TestRunResult>> {
  const instance = {
    containerId: config.containerId,
    phase: "execution" as const,
    labels: {},
  };

  const secretEnv = config.runtimeSecrets
    ? Object.entries(config.runtimeSecrets).map(([k, v]) => `${k}=${v}`)
    : undefined;
  const execResult = await sandbox.execCommand(
    instance,
    ["sh", "-c", config.testCommand],
    {
      workingDir: config.workingDir,
      timeoutMs: config.timeoutMs,
      env: secretEnv,
    },
  );

  if (execResult.isErr()) {
    return err(createFactoryError("sandbox_failure", execResult.error.message));
  }

  const { exitCode, stdout, stderr, durationMs } = execResult.value;
  const parsed = parseTestOutput(stdout, stderr);
  const allPassed = exitCode === 0;

  // Exit code is ground truth: if 0, zero failures regardless of parser output
  const failedCount = allPassed ? 0 : parsed.failed === 0 ? 1 : parsed.failed;

  const testResults: TestResults = {
    passed: allPassed && parsed.passed === 0 ? 1 : parsed.passed,
    failed: failedCount,
    skipped: parsed.skipped,
    newTests: [],
    modifiedTests: [],
    deletedTests: [],
    details: [...parsed.details],
  };

  const commandRecord: CommandRecord = {
    command: config.testCommand,
    exitCode,
    durationMs,
    output: `${stdout}\n${stderr}`.slice(0, 10_000),
  };

  return ok({ testResults, exitCode, commandRecord });
}
