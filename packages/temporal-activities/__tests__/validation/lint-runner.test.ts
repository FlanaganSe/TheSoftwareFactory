import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { ExecResult, SandboxSupervisor } from "../../src/sandbox/index.js";
import {
  parseBiomeJson,
  parseEslintJson,
  parseLintFallback,
  runLinter,
} from "../../src/validation/lint-runner.js";

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: "", stderr: "", durationMs: 50, ...overrides };
}

function makeSandbox(
  execResult: ExecResult = makeExecResult(),
): SandboxSupervisor {
  return {
    execCommand: vi.fn().mockResolvedValue(ok(execResult)),
  } as unknown as SandboxSupervisor;
}

describe("parseBiomeJson", () => {
  it("parses Biome diagnostics JSON", () => {
    const json = JSON.stringify({
      diagnostics: [
        {
          severity: "error",
          category: "lint/style/noVar",
          message: "Use let or const",
          location: { path: "src/a.ts", span: { start: 10 } },
        },
        {
          severity: "warning",
          category: "lint/style/useConst",
          message: "Use const",
          location: { path: "src/b.ts", span: { start: 20 } },
        },
      ],
    });
    const result = parseBiomeJson(json);
    expect(result).not.toBeNull();
    expect(result?.errorCount).toBe(1);
    expect(result?.warningCount).toBe(1);
    expect(result?.details).toHaveLength(2);
  });

  it("returns null for non-Biome JSON", () => {
    expect(parseBiomeJson('{"foo": "bar"}')).toBeNull();
  });
});

describe("parseEslintJson", () => {
  it("parses ESLint JSON output", () => {
    const json = JSON.stringify([
      {
        filePath: "src/index.ts",
        messages: [
          {
            severity: 2,
            ruleId: "no-var",
            message: "Use let",
            line: 1,
            column: 1,
          },
          {
            severity: 1,
            ruleId: "prefer-const",
            message: "Use const",
            line: 5,
            column: 3,
          },
        ],
      },
    ]);
    const result = parseEslintJson(json);
    expect(result).not.toBeNull();
    expect(result?.errorCount).toBe(1);
    expect(result?.warningCount).toBe(1);
    expect(result?.details).toHaveLength(2);
  });

  it("returns null for non-ESLint JSON", () => {
    expect(parseEslintJson('{"not": "eslint"}')).toBeNull();
  });
});

describe("parseLintFallback", () => {
  it("counts error and warning patterns in text", () => {
    const output = "error: something\nwarning: other\nerror: again";
    const result = parseLintFallback(output);
    expect(result.errorCount).toBe(2);
    expect(result.warningCount).toBe(1);
  });

  it("returns zero counts for clean output", () => {
    const result = parseLintFallback("All checks passed");
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });
});

describe("runLinter", () => {
  it("exit code 0 → no errors", async () => {
    const sandbox = makeSandbox(makeExecResult({ exitCode: 0 }));
    const result = await runLinter(
      {
        containerId: "c1",
        lintCommand: "npx biome check .",
        workingDir: "/workspace",
        timeoutMs: 120_000,
      },
      sandbox,
    );
    expect(result.isOk()).toBe(true);
    const { lintResults, exitCode } = result._unsafeUnwrap();
    expect(exitCode).toBe(0);
    expect(lintResults.errorCount).toBe(0);
  });

  it("lint command comes from config", async () => {
    const sandbox = makeSandbox(makeExecResult());
    await runLinter(
      {
        containerId: "c1",
        lintCommand: "custom-linter --strict",
        workingDir: "/workspace",
        timeoutMs: 120_000,
      },
      sandbox,
    );
    expect(sandbox.execCommand).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: "c1" }),
      ["sh", "-c", "custom-linter --strict"],
      expect.objectContaining({ workingDir: "/workspace" }),
    );
  });
});
