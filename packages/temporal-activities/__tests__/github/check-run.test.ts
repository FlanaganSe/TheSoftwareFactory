import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CheckRunConfig,
  buildAnnotations,
  computeCheckRunIdempotencyKey,
  computeConclusion,
  createCheckRunActivities,
  generateCheckRunSummary,
} from "../../src/github/check-run.js";
import type { CredentialBroker } from "../../src/github/credential-broker.js";
import type { SideEffectOps } from "../../src/github/pr.js";
import { MutationSerializer } from "../../src/github/rate-limiter.js";

vi.mock("../../src/github/client.js", () => ({
  createRestClient: vi.fn(),
}));

import { createRestClient } from "../../src/github/client.js";

// ─── Helpers ───

function makeMockBroker(): CredentialBroker {
  return {
    getToken: vi.fn().mockResolvedValue("mock-token"),
    getTokenForState: vi.fn().mockResolvedValue("mock-token"),
  } as unknown as CredentialBroker;
}

function makeMockSideEffects(): SideEffectOps {
  return {
    getSideEffect: vi.fn().mockResolvedValue(ok(null)),
    recordSideEffect: vi.fn().mockResolvedValue(ok(undefined)),
    completeSideEffect: vi.fn().mockResolvedValue(ok(undefined)),
    failSideEffect: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeMockClient() {
  return {
    checks: {
      create: vi.fn(),
      update: vi.fn(),
    },
  };
}

function makeBaseConfig(
  overrides: Partial<CheckRunConfig> = {},
): CheckRunConfig {
  return {
    owner: "test-owner",
    repo: "test-repo",
    headSha: "abc123",
    taskId: "task-1",
    validationPassed: true,
    testResults: { passed: 10, failed: 0, skipped: 0 },
    lintResults: { errorCount: 0, warningCount: 0 },
    securityScanResults: {
      criticalCount: 0,
      highCount: 0,
      vulnerabilities: [],
    },
    blastRadius: { files: 3, packages: 1 },
    protectedEdits: [],
    ...overrides,
  };
}

// ─── Pure function tests ───

describe("computeConclusion", () => {
  it("returns 'success' when all tests pass and no critical vulns", () => {
    const config = makeBaseConfig();
    expect(computeConclusion(config)).toBe("success");
  });

  it("returns 'failure' when test failures exist", () => {
    const config = makeBaseConfig({
      testResults: { passed: 8, failed: 2, skipped: 0 },
    });
    expect(computeConclusion(config)).toBe("failure");
  });

  it("returns 'failure' when critical vulnerabilities exist", () => {
    const config = makeBaseConfig({
      securityScanResults: {
        criticalCount: 1,
        highCount: 0,
        vulnerabilities: [
          {
            severity: "critical",
            description: "RCE in dependency",
            id: "CVE-2025-001",
            file: "package.json",
            line: 5,
          },
        ],
      },
    });
    expect(computeConclusion(config)).toBe("failure");
  });

  it("returns 'neutral' when only warnings exist (no failures)", () => {
    const config = makeBaseConfig({
      lintResults: { errorCount: 0, warningCount: 3 },
    });
    expect(computeConclusion(config)).toBe("neutral");
  });

  it("returns 'failure' when lint errors exist", () => {
    const config = makeBaseConfig({
      lintResults: { errorCount: 2, warningCount: 0 },
    });
    expect(computeConclusion(config)).toBe("failure");
  });

  it("returns 'neutral' when high-severity vulns exist but no critical", () => {
    const config = makeBaseConfig({
      securityScanResults: {
        criticalCount: 0,
        highCount: 2,
        vulnerabilities: [
          {
            severity: "high",
            description: "XSS vector",
            id: "CVE-2025-010",
          },
          {
            severity: "high",
            description: "SSRF",
            id: "CVE-2025-011",
          },
        ],
      },
    });
    expect(computeConclusion(config)).toBe("neutral");
  });
});

describe("generateCheckRunSummary", () => {
  it("includes all sections: tests, lint, security, blast radius", () => {
    const config = makeBaseConfig({
      testResults: { passed: 15, failed: 1, skipped: 2 },
      lintResults: { errorCount: 3, warningCount: 7 },
      securityScanResults: {
        criticalCount: 1,
        highCount: 2,
        vulnerabilities: [
          {
            severity: "critical",
            description: "d",
            id: "a",
          },
          { severity: "high", description: "d", id: "b" },
          { severity: "high", description: "d", id: "c" },
          {
            severity: "medium",
            description: "d",
            id: "d",
          },
          { severity: "low", description: "d", id: "e" },
        ],
      },
      blastRadius: { files: 12, packages: 3 },
    });

    const summary = generateCheckRunSummary(config);

    expect(summary).toContain("### Tests");
    expect(summary).toContain("15 passed | 1 failed | 2 skipped");
    expect(summary).toContain("### Lint");
    expect(summary).toContain("3 errors | 7 warnings");
    expect(summary).toContain("### Security");
    expect(summary).toContain("1 critical | 2 high | 1 medium | 1 low");
    expect(summary).toContain("### Blast Radius");
    expect(summary).toContain("12 files changed | 3 packages affected");
  });

  it("includes evidence link when evidenceUrl is provided", () => {
    const config = makeBaseConfig({
      evidenceUrl: "https://evidence.example.com/task-1",
    });
    const summary = generateCheckRunSummary(config);
    expect(summary).toContain(
      "[View full evidence](https://evidence.example.com/task-1)",
    );
  });

  it("omits evidence link when evidenceUrl is not provided", () => {
    const config = makeBaseConfig();
    const summary = generateCheckRunSummary(config);
    expect(summary).not.toContain("View full evidence");
  });
});

describe("buildAnnotations", () => {
  it("generates annotations for security findings with file locations", () => {
    const config = makeBaseConfig({
      securityScanResults: {
        criticalCount: 1,
        highCount: 0,
        vulnerabilities: [
          {
            severity: "critical",
            description: "Remote code execution via eval()",
            file: "src/handler.ts",
            line: 42,
            id: "CVE-2025-100",
          },
        ],
      },
    });

    const annotations = buildAnnotations(config);

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toEqual({
      path: "src/handler.ts",
      start_line: 42,
      end_line: 42,
      annotation_level: "failure",
      message: "Remote code execution via eval()",
      title: "Security: CVE-2025-100 (critical)",
    });
  });

  it("skips security findings without a file path", () => {
    const config = makeBaseConfig({
      securityScanResults: {
        criticalCount: 0,
        highCount: 1,
        vulnerabilities: [
          {
            severity: "high",
            description: "Vulnerable dependency",
            id: "CVE-2025-200",
            // no file
          },
        ],
      },
    });

    const annotations = buildAnnotations(config);
    expect(annotations).toHaveLength(0);
  });

  it("generates annotations for lint errors", () => {
    const config = makeBaseConfig({
      lintResults: {
        errorCount: 1,
        warningCount: 1,
        details: [
          {
            file: "src/util.ts",
            line: 10,
            rule: "no-unused-vars",
            severity: "error",
            message: "Variable 'x' is declared but never used",
          },
          {
            file: "src/app.ts",
            line: 5,
            rule: "no-console",
            severity: "warning",
            message: "Unexpected console statement",
          },
        ],
      },
    });

    const annotations = buildAnnotations(config);

    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toEqual({
      path: "src/util.ts",
      start_line: 10,
      end_line: 10,
      annotation_level: "failure",
      message: "no-unused-vars: Variable 'x' is declared but never used",
      title: "Lint: no-unused-vars",
    });
    expect(annotations[1]).toEqual({
      path: "src/app.ts",
      start_line: 5,
      end_line: 5,
      annotation_level: "warning",
      message: "no-console: Unexpected console statement",
      title: "Lint: no-console",
    });
  });

  it("generates notice annotations for protected edits", () => {
    const config = makeBaseConfig({
      protectedEdits: [
        { filePath: ".github/workflows/ci.yml", protectionClass: "ci" },
        { filePath: "CODEOWNERS", protectionClass: "ownership" },
      ],
    });

    const annotations = buildAnnotations(config);

    expect(annotations).toHaveLength(2);
    for (const a of annotations) {
      expect(a.annotation_level).toBe("notice");
      expect(a.title).toBe("Protected Surface Edit");
    }
    expect(annotations[0]).toMatchObject({
      path: ".github/workflows/ci.yml",
      message: "Protected surface edit (ci)",
    });
    expect(annotations[1]).toMatchObject({
      path: "CODEOWNERS",
      message: "Protected surface edit (ownership)",
    });
  });

  it("uses line 1 as default when security finding has no line number", () => {
    const config = makeBaseConfig({
      securityScanResults: {
        criticalCount: 0,
        highCount: 1,
        vulnerabilities: [
          {
            severity: "high",
            description: "Insecure default",
            file: "config.ts",
            // no line
            id: "SEC-001",
          },
        ],
      },
    });

    const annotations = buildAnnotations(config);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.start_line).toBe(1);
    expect(annotations[0]?.end_line).toBe(1);
  });
});

describe("computeCheckRunIdempotencyKey", () => {
  it("produces a deterministic hex hash", () => {
    const key1 = computeCheckRunIdempotencyKey("task-1", "sha-abc");
    const key2 = computeCheckRunIdempotencyKey("task-1", "sha-abc");
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different keys for different inputs", () => {
    const key1 = computeCheckRunIdempotencyKey("task-1", "sha-abc");
    const key2 = computeCheckRunIdempotencyKey("task-2", "sha-abc");
    expect(key1).not.toBe(key2);
  });
});

// ─── Activity integration tests (mocked Octokit) ───

describe("createCheckRunActivities", () => {
  let broker: CredentialBroker;
  let serializer: MutationSerializer;
  let sideEffects: SideEffectOps;
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = makeMockBroker();
    serializer = new MutationSerializer();
    vi.spyOn(serializer, "waitForSlot").mockResolvedValue(undefined);
    sideEffects = makeMockSideEffects();
    mockClient = makeMockClient();
    vi.mocked(createRestClient).mockReturnValue(mockClient as never);
  });

  describe("createFactoryCheckRun", () => {
    it("creates a check run and returns its id and url", async () => {
      const activities = createCheckRunActivities({
        credentialBroker: broker,
        serializer,
        sideEffects,
      });

      mockClient.checks.create.mockResolvedValue({
        data: { id: 42, html_url: "https://github.com/checks/42" },
      });

      const config = makeBaseConfig();
      const result = await activities.createFactoryCheckRun(config);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        checkRunId: 42,
        checkRunUrl: "https://github.com/checks/42",
      });

      expect(mockClient.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-owner",
          repo: "test-repo",
          head_sha: "abc123",
          status: "completed",
          conclusion: "success",
        }),
      );
    });

    it("returns existing data when side-effect already completed (idempotent)", async () => {
      vi.mocked(sideEffects.getSideEffect).mockResolvedValue(
        ok({
          status: "completed",
          responsePayload: {
            checkRunId: 99,
            checkRunUrl: "https://github.com/checks/99",
          },
        }),
      );

      const activities = createCheckRunActivities({
        credentialBroker: broker,
        serializer,
        sideEffects,
      });

      const config = makeBaseConfig();
      const result = await activities.createFactoryCheckRun(config);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        checkRunId: 99,
        checkRunUrl: "https://github.com/checks/99",
      });

      // Should NOT have called the GitHub API
      expect(mockClient.checks.create).not.toHaveBeenCalled();
    });

    it("batches annotations at 50 per update when >50 annotations", async () => {
      // Generate 120 lint annotations (exceeds 2 batches of 50)
      const lintDetails = Array.from({ length: 120 }, (_, i) => ({
        file: `src/file-${i}.ts`,
        line: i + 1,
        rule: "no-unused-vars",
        severity: "warning" as const,
        message: `Unused variable #${i}`,
      }));

      const config = makeBaseConfig({
        lintResults: {
          errorCount: 0,
          warningCount: 120,
          details: lintDetails,
        },
      });

      mockClient.checks.create.mockResolvedValue({
        data: { id: 50, html_url: "https://github.com/checks/50" },
      });
      mockClient.checks.update.mockResolvedValue({ data: {} });

      const activities = createCheckRunActivities({
        credentialBroker: broker,
        serializer,
        sideEffects,
      });

      const result = await activities.createFactoryCheckRun(config);

      expect(result.isOk()).toBe(true);

      // First 50 annotations go in checks.create
      expect(mockClient.checks.create).toHaveBeenCalledTimes(1);
      const createCall = mockClient.checks.create.mock.calls[0]?.[0];
      expect(createCall.output.annotations).toHaveLength(50);

      // Remaining 70 annotations: 50 in first update, 20 in second update
      expect(mockClient.checks.update).toHaveBeenCalledTimes(2);
      const firstUpdate = mockClient.checks.update.mock.calls[0]?.[0];
      expect(firstUpdate.output.annotations).toHaveLength(50);
      expect(firstUpdate.check_run_id).toBe(50);

      const secondUpdate = mockClient.checks.update.mock.calls[1]?.[0];
      expect(secondUpdate.output.annotations).toHaveLength(20);
    });

    it("records and completes side-effect on success", async () => {
      mockClient.checks.create.mockResolvedValue({
        data: { id: 7, html_url: "https://github.com/checks/7" },
      });

      const activities = createCheckRunActivities({
        credentialBroker: broker,
        serializer,
        sideEffects,
      });

      const config = makeBaseConfig();
      await activities.createFactoryCheckRun(config);

      expect(sideEffects.recordSideEffect).toHaveBeenCalledWith(
        "task-1",
        "create_check_run",
        expect.any(String),
        expect.any(String),
      );
      expect(sideEffects.completeSideEffect).toHaveBeenCalledWith(
        expect.any(String),
        { checkRunId: 7, checkRunUrl: "https://github.com/checks/7" },
      );
    });

    it("returns error and records failure when GitHub API throws", async () => {
      mockClient.checks.create.mockRejectedValue(
        new Error("API rate limit exceeded"),
      );

      const activities = createCheckRunActivities({
        credentialBroker: broker,
        serializer,
        sideEffects,
      });

      const config = makeBaseConfig();
      const result = await activities.createFactoryCheckRun(config);

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("github_transient");
      expect(result._unsafeUnwrapErr().message).toContain(
        "API rate limit exceeded",
      );
      expect(sideEffects.failSideEffect).toHaveBeenCalledWith(
        expect.any(String),
        "API rate limit exceeded",
      );
    });

    it("sets title to 'Issues Found' when validation failed", async () => {
      mockClient.checks.create.mockResolvedValue({
        data: { id: 1, html_url: "" },
      });

      const activities = createCheckRunActivities({
        credentialBroker: broker,
        serializer,
        sideEffects,
      });

      const config = makeBaseConfig({
        validationPassed: false,
        testResults: { passed: 5, failed: 3, skipped: 0 },
      });

      await activities.createFactoryCheckRun(config);

      const createCall = mockClient.checks.create.mock.calls[0]?.[0];
      expect(createCall.output.title).toBe("Factory Validation: Issues Found");
      expect(createCall.conclusion).toBe("failure");
    });

    it("uses MutationSerializer for rate limiting on create and batch updates", async () => {
      const lintDetails = Array.from({ length: 60 }, (_, i) => ({
        file: `src/file-${i}.ts`,
        line: i + 1,
        rule: "rule",
        severity: "warning" as const,
        message: `msg-${i}`,
      }));

      const config = makeBaseConfig({
        lintResults: { errorCount: 0, warningCount: 60, details: lintDetails },
      });

      mockClient.checks.create.mockResolvedValue({
        data: { id: 10, html_url: "" },
      });
      mockClient.checks.update.mockResolvedValue({ data: {} });

      const activities = createCheckRunActivities({
        credentialBroker: broker,
        serializer,
        sideEffects,
      });

      await activities.createFactoryCheckRun(config);

      // 1 for create + 1 for the single batch update (60 - 50 = 10 remaining)
      expect(serializer.waitForSlot).toHaveBeenCalledTimes(2);
    });
  });
});
