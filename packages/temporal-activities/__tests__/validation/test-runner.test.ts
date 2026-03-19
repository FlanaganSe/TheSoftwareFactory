import { ok } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import type { ExecResult, SandboxSupervisor } from "../../src/sandbox/index.js";
import {
  parseGoTest,
  parseJunitXml,
  parsePytest,
  parseRustTest,
  parseTestOutput,
  parseVitestJest,
  runTests,
} from "../../src/validation/test-runner.js";

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return { exitCode: 0, stdout: "", stderr: "", durationMs: 100, ...overrides };
}

function makeSandbox(
  execResult: ExecResult = makeExecResult(),
): SandboxSupervisor {
  return {
    execCommand: vi.fn().mockResolvedValue(ok(execResult)),
    execWithSecrets: vi.fn().mockResolvedValue(ok(execResult)),
  } as unknown as SandboxSupervisor;
}

describe("parseVitestJest", () => {
  it("parses Vitest/Jest summary with all fields", () => {
    const output = "Tests:  12 passed, 3 failed, 2 skipped";
    const result = parseVitestJest(output);
    expect(result).toEqual({
      passed: 12,
      failed: 3,
      skipped: 2,
      details: [],
    });
  });

  it("returns null for non-matching output", () => {
    expect(parseVitestJest("Hello world")).toBeNull();
  });
});

describe("parsePytest", () => {
  it("parses pytest summary", () => {
    const output = "===== 5 passed, 2 failed, 1 skipped =====";
    const result = parsePytest(output);
    expect(result).toEqual({
      passed: 5,
      failed: 2,
      skipped: 1,
      details: [],
    });
  });

  it("returns null for non-pytest output", () => {
    expect(parsePytest("Hello world")).toBeNull();
  });
});

describe("parseGoTest", () => {
  it("parses Go test output", () => {
    const output = [
      "ok  \tgithub.com/example/pkg1\t0.123s",
      "ok  \tgithub.com/example/pkg2\t0.456s",
      "FAIL\tgithub.com/example/pkg3\t0.789s",
    ].join("\n");
    const result = parseGoTest(output);
    expect(result).toEqual({
      passed: 2,
      failed: 1,
      skipped: 0,
      details: [],
    });
  });

  it("returns null for non-Go output", () => {
    expect(parseGoTest("Hello world")).toBeNull();
  });
});

describe("parseRustTest", () => {
  it("parses Rust test result", () => {
    const output = "test result: ok. 10 passed; 1 failed; 2 ignored";
    const result = parseRustTest(output);
    expect(result).toEqual({
      passed: 10,
      failed: 1,
      skipped: 2,
      details: [],
    });
  });
});

describe("parseJunitXml", () => {
  it("parses JUnit XML with test details", () => {
    const xml = `<?xml version="1.0"?>
<testsuite tests="3" failures="1" skipped="1">
  <testcase name="test_add">good</testcase>
  <testcase name="test_sub"><failure message="expected 5 got 3"/></testcase>
  <testcase name="test_skip"><skipped/></testcase>
</testsuite>`;
    const result = parseJunitXml(xml);
    expect(result).not.toBeNull();
    expect(result?.passed).toBe(1);
    expect(result?.failed).toBe(1);
    expect(result?.skipped).toBe(1);
    expect(result?.details).toHaveLength(3);
    expect(result?.details[0]).toEqual({ name: "test_add", status: "passed" });
    expect(result?.details[1]).toEqual({
      name: "test_sub",
      status: "failed",
      errorMessage: "expected 5 got 3",
    });
    expect(result?.details[2]).toEqual({
      name: "test_skip",
      status: "skipped",
    });
  });

  it("returns null for non-XML input", () => {
    expect(parseJunitXml("not xml")).toBeNull();
  });
});

describe("parseTestOutput", () => {
  it("falls back to empty counts for unrecognized output", () => {
    const result = parseTestOutput("some random output", "");
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("exit code is still ground truth for empty output", () => {
    const result = parseTestOutput("", "");
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe("runTests", () => {
  it("exit code 0 → passed", async () => {
    const sandbox = makeSandbox(
      makeExecResult({ exitCode: 0, stdout: "Tests:  5 passed" }),
    );
    const result = await runTests(
      {
        containerId: "c1",
        testCommand: "npm test",
        workingDir: "/workspace",
        timeoutMs: 300_000,
      },
      sandbox,
    );
    expect(result.isOk()).toBe(true);
    const { testResults, exitCode } = result._unsafeUnwrap();
    expect(exitCode).toBe(0);
    expect(testResults.failed).toBe(0);
    expect(testResults.passed).toBe(5);
  });

  it("non-zero exit code → failed", async () => {
    const sandbox = makeSandbox(
      makeExecResult({
        exitCode: 1,
        stdout: "Tests:  3 passed, 2 failed",
      }),
    );
    const result = await runTests(
      {
        containerId: "c1",
        testCommand: "npm test",
        workingDir: "/workspace",
        timeoutMs: 300_000,
      },
      sandbox,
    );
    expect(result.isOk()).toBe(true);
    const { testResults, exitCode } = result._unsafeUnwrap();
    expect(exitCode).toBe(1);
    expect(testResults.failed).toBe(2);
    expect(testResults.passed).toBe(3);
  });

  it("test command comes from config, not workspace", async () => {
    const sandbox = makeSandbox(makeExecResult());
    await runTests(
      {
        containerId: "c1",
        testCommand: "my-custom-test-command",
        workingDir: "/workspace",
        timeoutMs: 300_000,
      },
      sandbox,
    );
    expect(sandbox.execCommand).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: "c1" }),
      ["sh", "-c", "my-custom-test-command"],
      expect.objectContaining({ workingDir: "/workspace" }),
    );
  });

  it("records command in result", async () => {
    const sandbox = makeSandbox(
      makeExecResult({ exitCode: 0, durationMs: 5000 }),
    );
    const result = await runTests(
      {
        containerId: "c1",
        testCommand: "npm test",
        workingDir: "/workspace",
        timeoutMs: 300_000,
      },
      sandbox,
    );
    const { commandRecord } = result._unsafeUnwrap();
    expect(commandRecord.command).toBe("npm test");
    expect(commandRecord.exitCode).toBe(0);
    expect(commandRecord.durationMs).toBe(5000);
  });
});
