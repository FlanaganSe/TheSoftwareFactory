import type { TrustedBaseContext } from "@software-factory/core";
import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { ExecResult, SandboxSupervisor } from "../../src/sandbox/index.js";
import {
  categorizeControlFile,
  checkValidatorBoundary,
  computeHash,
} from "../../src/validation/validator-boundary.js";

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: "", stderr: "", durationMs: 10, ...overrides };
}

function makeTrustedContext(
  overrides: Partial<TrustedBaseContext> = {},
): TrustedBaseContext {
  return {
    baseSha: "abc123",
    setupContract: null,
    policySnapshot: [],
    behavioralControlFiles: {},
    validationCommandSources: [],
    capturedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("categorizeControlFile", () => {
  it("categorizes vitest.config.ts as test_config", () => {
    expect(categorizeControlFile("vitest.config.ts")).toBe("test_config");
  });

  it("categorizes .semgrepignore as security_config", () => {
    expect(categorizeControlFile(".semgrepignore")).toBe("security_config");
  });

  it("categorizes .factory/setup.yml as factory_config", () => {
    expect(categorizeControlFile(".factory/setup.yml")).toBe("factory_config");
  });

  it("categorizes .github/workflows/ci.yml as ci_config", () => {
    expect(categorizeControlFile(".github/workflows/ci.yml")).toBe("ci_config");
  });

  it("categorizes biome.json as lint_config", () => {
    expect(categorizeControlFile("biome.json")).toBe("lint_config");
  });
});

describe("checkValidatorBoundary", () => {
  it("no control files modified → empty edit list", async () => {
    const sandbox = {
      execCommand: vi.fn().mockResolvedValue(
        ok(makeExecResult({ exitCode: 1 })), // Files don't exist
      ),
    } as unknown as SandboxSupervisor;

    const result = await checkValidatorBoundary({
      containerId: "c1",
      trustedContext: makeTrustedContext(),
      sandbox,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it("test config modified → detected with category test_config", async () => {
    const originalContent = "export default { test: { timeout: 5000 } }";
    const modifiedContent = "export default { test: { timeout: 999999 } }";

    const sandbox = {
      execCommand: vi
        .fn()
        .mockImplementation(
          async (_instance: unknown, cmd: readonly string[]) => {
            const cmdStr = cmd.join(" ");
            if (cmdStr.includes("cat /workspace/vitest.config.ts")) {
              return ok(makeExecResult({ stdout: modifiedContent }));
            }
            // All other files don't exist or haven't changed
            return ok(makeExecResult({ exitCode: 1 }));
          },
        ),
    } as unknown as SandboxSupervisor;

    const result = await checkValidatorBoundary({
      containerId: "c1",
      trustedContext: makeTrustedContext({
        behavioralControlFiles: {
          "vitest.config.ts": originalContent,
        },
      }),
      sandbox,
    });

    expect(result.isOk()).toBe(true);
    const edits = result._unsafeUnwrap();
    expect(edits.length).toBeGreaterThanOrEqual(1);
    const testConfigEdit = edits.find((e) => e.path === "vitest.config.ts");
    expect(testConfigEdit).toBeDefined();
    expect(testConfigEdit?.category).toBe("test_config");
    expect(testConfigEdit?.baseRefHash).toBe(computeHash(originalContent));
    expect(testConfigEdit?.workspaceHash).toBe(computeHash(modifiedContent));
  });

  it("semgrep config modified → detected with category security_config", async () => {
    const original = "rules:\n  - id: test-rule";
    const modified = "rules: []";

    const sandbox = {
      execCommand: vi
        .fn()
        .mockImplementation(
          async (_instance: unknown, cmd: readonly string[]) => {
            const cmdStr = cmd.join(" ");
            if (cmdStr.includes("cat /workspace/.semgrep.yml")) {
              return ok(makeExecResult({ stdout: modified }));
            }
            return ok(makeExecResult({ exitCode: 1 }));
          },
        ),
    } as unknown as SandboxSupervisor;

    const result = await checkValidatorBoundary({
      containerId: "c1",
      trustedContext: makeTrustedContext({
        behavioralControlFiles: { ".semgrep.yml": original },
      }),
      sandbox,
    });

    expect(result.isOk()).toBe(true);
    const edits = result._unsafeUnwrap();
    const semgrepEdit = edits.find((e) => e.path === ".semgrep.yml");
    expect(semgrepEdit).toBeDefined();
    expect(semgrepEdit?.category).toBe("security_config");
  });

  it("factory config modified → detected with category factory_config", async () => {
    const original = "version: 1";
    const modified = "version: 2";

    const sandbox = {
      execCommand: vi
        .fn()
        .mockImplementation(
          async (_instance: unknown, cmd: readonly string[]) => {
            const cmdStr = cmd.join(" ");
            if (cmdStr.includes("cat /workspace/.factory/setup.yml")) {
              return ok(makeExecResult({ stdout: modified }));
            }
            return ok(makeExecResult({ exitCode: 1 }));
          },
        ),
    } as unknown as SandboxSupervisor;

    const result = await checkValidatorBoundary({
      containerId: "c1",
      trustedContext: makeTrustedContext({
        behavioralControlFiles: { ".factory/setup.yml": original },
      }),
      sandbox,
    });

    expect(result.isOk()).toBe(true);
    const edits = result._unsafeUnwrap();
    const factoryEdit = edits.find((e) => e.path === ".factory/setup.yml");
    expect(factoryEdit).toBeDefined();
    expect(factoryEdit?.category).toBe("factory_config");
  });

  it("hash comparison: identical content → no edit flagged", async () => {
    const content = "export default { test: true }";

    const sandbox = {
      execCommand: vi
        .fn()
        .mockImplementation(
          async (_instance: unknown, cmd: readonly string[]) => {
            const cmdStr = cmd.join(" ");
            if (cmdStr.includes("cat /workspace/vitest.config.ts")) {
              return ok(makeExecResult({ stdout: content })); // Same content
            }
            return ok(makeExecResult({ exitCode: 1 }));
          },
        ),
    } as unknown as SandboxSupervisor;

    const result = await checkValidatorBoundary({
      containerId: "c1",
      trustedContext: makeTrustedContext({
        behavioralControlFiles: { "vitest.config.ts": content },
      }),
      sandbox,
    });

    expect(result.isOk()).toBe(true);
    const edits = result._unsafeUnwrap();
    expect(edits.find((e) => e.path === "vitest.config.ts")).toBeUndefined();
  });

  it("well-known file modified but not in trusted context → still detected", async () => {
    const sandbox = {
      execCommand: vi
        .fn()
        .mockImplementation(
          async (_instance: unknown, cmd: readonly string[]) => {
            const cmdStr = cmd.join(" ");
            if (cmdStr.includes("cat /workspace/biome.json")) {
              return ok(makeExecResult({ stdout: '{"linter":{}}' }));
            }
            // git diff shows biome.json was modified
            if (cmdStr.includes("git diff") && cmdStr.includes("biome.json")) {
              return ok(makeExecResult({ stdout: "biome.json\n" }));
            }
            return ok(makeExecResult({ exitCode: 1, stdout: "" }));
          },
        ),
    } as unknown as SandboxSupervisor;

    const result = await checkValidatorBoundary({
      containerId: "c1",
      trustedContext: makeTrustedContext(), // No behavioral control files
      sandbox,
    });

    expect(result.isOk()).toBe(true);
    const edits = result._unsafeUnwrap();
    const biomeEdit = edits.find((e) => e.path === "biome.json");
    expect(biomeEdit).toBeDefined();
    expect(biomeEdit?.category).toBe("lint_config");
  });
});
