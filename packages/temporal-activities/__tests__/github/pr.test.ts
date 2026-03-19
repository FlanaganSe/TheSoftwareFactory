import type { CapabilitySnapshot } from "@software-factory/core";
import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidenceLocator } from "../../src/evidence/locator.js";
import type { RiskCategorization } from "../../src/evidence/risk-summary.js";
import type { CredentialBroker } from "../../src/github/credential-broker.js";
import {
  type CreatePRConfig,
  type PRActivityDeps,
  type SideEffectOps,
  type SideEffectRecord,
  buildPRTitle,
  createPRActivities,
  generatePRBody,
} from "../../src/github/pr.js";
import { MutationSerializer } from "../../src/github/rate-limiter.js";

vi.mock("../../src/github/client.js", () => ({
  createRestClient: vi.fn(),
}));

import { createRestClient } from "../../src/github/client.js";

// ─── Helpers ───

function makeMockSideEffects(): SideEffectOps {
  return {
    getSideEffect: vi.fn().mockResolvedValue(ok(null)),
    recordSideEffect: vi.fn().mockResolvedValue(ok(undefined)),
    completeSideEffect: vi.fn().mockResolvedValue(ok(undefined)),
    failSideEffect: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeMockBroker(): CredentialBroker {
  return {
    getToken: vi.fn().mockResolvedValue("mock-token"),
    getTokenForState: vi.fn().mockResolvedValue("mock-token"),
  } as unknown as CredentialBroker;
}

function makeMockClient() {
  return {
    pulls: {
      create: vi.fn(),
      list: vi.fn(),
      update: vi.fn(),
    },
  };
}

function makeValidationResult() {
  return {
    testResults: { passed: 42, failed: 0, skipped: 2 },
    lintResults: { errorCount: 0, warningCount: 3 },
    securityScanResults: {
      criticalCount: 0,
      highCount: 0,
      vulnerabilities: [],
    },
    blastRadius: { files: 5, packages: 2 },
    revertabilityClass: "safe",
  } as const;
}

function makeRiskSummary(): RiskCategorization {
  return {
    hardBlockers: [],
    softConcerns: ["1 protected surface edit(s)"],
    humanJudgmentRequired: [],
    informational: ["2 low-risk change(s)"],
  };
}

function makeEvidenceLocator(): EvidenceLocator {
  return {
    taskId: "task-42",
    attemptNumber: 1,
    bundleId: "bundle-abc",
    artifactPrefix: "evidence/task-42/1/",
    evidenceJsonKey: "evidence/task-42/1/evidence.json",
    manifestKey: "evidence/task-42/1/manifest.json",
    diffPatchKey: "evidence/task-42/1/diff.patch",
    createdAt: "2026-03-19T00:00:00.000Z",
  };
}

function makeConfig(overrides?: Partial<CreatePRConfig>): CreatePRConfig {
  return {
    owner: "test-org",
    repo: "test-repo",
    candidateBranch: "factory/task-42",
    baseBranch: "main",
    taskId: "task-42",
    objective: "Add user authentication module",
    evidenceLocator: makeEvidenceLocator(),
    riskSummary: makeRiskSummary(),
    validationPassed: true,
    headSha: "abc1234567890def",
    capabilitySnapshot: {} as CapabilitySnapshot,
    attemptNumber: 1,
    validationResult: makeValidationResult(),
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<PRActivityDeps>): PRActivityDeps {
  return {
    credentialBroker: makeMockBroker(),
    serializer: new MutationSerializer(),
    sideEffects: makeMockSideEffects(),
    ...overrides,
  };
}

// ─── Tests ───

describe("createPRActivities", () => {
  let mockClient: ReturnType<typeof makeMockClient>;
  let deps: PRActivityDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = makeMockClient();
    vi.mocked(createRestClient).mockReturnValue(mockClient as never);
    deps = makeDeps();
    vi.spyOn(deps.serializer, "waitForSlot").mockResolvedValue(undefined);
  });

  describe("createPullRequest", () => {
    it("creates PR with valid config and returns prNumber, prUrl, and prNodeId", async () => {
      mockClient.pulls.create.mockResolvedValue({
        data: {
          number: 99,
          html_url: "https://github.com/test-org/test-repo/pull/99",
          node_id: "PR_node_abc",
        },
      });

      const activities = createPRActivities(deps);
      const result = await activities.createPullRequest(
        makeConfig(),
        "http://localhost:3000",
      );

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      expect(value).toEqual({
        prNumber: 99,
        prUrl: "https://github.com/test-org/test-repo/pull/99",
        prNodeId: "PR_node_abc",
        headSha: "abc1234567890def",
      });

      expect(mockClient.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-org",
          repo: "test-repo",
          head: "factory/task-42",
          base: "main",
          draft: false,
        }),
      );
    });

    it("returns existing data without API call when side-effect is completed", async () => {
      const completedRecord: SideEffectRecord = {
        status: "completed",
        responsePayload: {
          prNumber: 55,
          prUrl: "https://github.com/test-org/test-repo/pull/55",
          prNodeId: "PR_existing_node",
        },
      };
      vi.mocked(deps.sideEffects.getSideEffect).mockResolvedValue(
        ok(completedRecord),
      );

      const activities = createPRActivities(deps);
      const result = await activities.createPullRequest(
        makeConfig(),
        "http://localhost:3000",
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        prNumber: 55,
        prUrl: "https://github.com/test-org/test-repo/pull/55",
        prNodeId: "PR_existing_node",
        headSha: "abc1234567890def",
      });

      expect(mockClient.pulls.create).not.toHaveBeenCalled();
    });

    it("retries PR creation when side-effect has failed status", async () => {
      const failedRecord: SideEffectRecord = {
        status: "failed",
        responsePayload: null,
      };
      vi.mocked(deps.sideEffects.getSideEffect).mockResolvedValue(
        ok(failedRecord),
      );

      mockClient.pulls.create.mockResolvedValue({
        data: {
          number: 77,
          html_url: "https://github.com/test-org/test-repo/pull/77",
          node_id: "PR_retry_node",
        },
      });

      const activities = createPRActivities(deps);
      const result = await activities.createPullRequest(
        makeConfig(),
        "http://localhost:3000",
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().prNumber).toBe(77);

      // Should NOT record a new side-effect since the failed record already exists
      expect(deps.sideEffects.recordSideEffect).not.toHaveBeenCalled();
      // Should still make the API call
      expect(mockClient.pulls.create).toHaveBeenCalledTimes(1);
    });

    it("finds and returns existing PR on 422 'already exists' error", async () => {
      mockClient.pulls.create.mockRejectedValue({
        status: 422,
        message:
          "Validation Failed: A pull request already exists for test-org:factory/task-42",
      });

      mockClient.pulls.list.mockResolvedValue({
        data: [
          {
            number: 33,
            html_url: "https://github.com/test-org/test-repo/pull/33",
            node_id: "PR_already_exists",
          },
        ],
      });

      const activities = createPRActivities(deps);
      const result = await activities.createPullRequest(
        makeConfig(),
        "http://localhost:3000",
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        prNumber: 33,
        prUrl: "https://github.com/test-org/test-repo/pull/33",
        prNodeId: "PR_already_exists",
        headSha: "abc1234567890def",
      });

      expect(mockClient.pulls.list).toHaveBeenCalledWith({
        owner: "test-org",
        repo: "test-repo",
        head: "test-org:factory/task-42",
        base: "main",
        state: "open",
      });
    });

    it("returns non-retryable error on 422 'No commits between base and head'", async () => {
      mockClient.pulls.create.mockRejectedValue({
        status: 422,
        message: "No commits between main and factory/task-42",
      });

      const activities = createPRActivities(deps);
      const result = await activities.createPullRequest(
        makeConfig(),
        "http://localhost:3000",
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("evidence_invariant_fail");
      expect(error.message).toContain("No commits between base and head");

      expect(deps.sideEffects.failSideEffect).toHaveBeenCalled();
    });

    it("truncates PR title to 60 chars of objective", async () => {
      const longObjective =
        "Implement the entire authentication system with OAuth2 integration and session management and rate limiting";

      mockClient.pulls.create.mockResolvedValue({
        data: {
          number: 1,
          html_url: "https://github.com/test-org/test-repo/pull/1",
          node_id: "PR_1",
        },
      });

      const activities = createPRActivities(deps);
      await activities.createPullRequest(
        makeConfig({ objective: longObjective }),
        "http://localhost:3000",
      );

      const callArgs = mockClient.pulls.create.mock.calls[0][0];
      expect(callArgs.title.length).toBeLessThanOrEqual(60);
      expect(callArgs.title).toMatch(/^factory: /);
      expect(callArgs.title).toMatch(/\.\.\.$/);
    });

    it("calls serializer.waitForSlot before mutation", async () => {
      mockClient.pulls.create.mockResolvedValue({
        data: {
          number: 10,
          html_url: "https://github.com/test-org/test-repo/pull/10",
          node_id: "PR_10",
        },
      });

      const activities = createPRActivities(deps);
      await activities.createPullRequest(makeConfig(), "http://localhost:3000");

      expect(deps.serializer.waitForSlot).toHaveBeenCalledTimes(1);
    });

    it("scopes token to pr_creation phase", async () => {
      mockClient.pulls.create.mockResolvedValue({
        data: {
          number: 10,
          html_url: "https://github.com/test-org/test-repo/pull/10",
          node_id: "PR_10",
        },
      });

      const activities = createPRActivities(deps);
      await activities.createPullRequest(makeConfig(), "http://localhost:3000");

      expect(deps.credentialBroker.getToken).toHaveBeenCalledWith(
        "pr_creation",
      );
    });
  });
});

describe("generatePRBody", () => {
  it("contains all required sections: objective, risk, validation, evidence link", () => {
    const config = makeConfig();
    const body = generatePRBody(config, "http://localhost:3000");

    expect(body).toContain("### Objective");
    expect(body).toContain("Add user authentication module");
    expect(body).toContain("### Risk Summary");
    expect(body).toContain("Hard Blockers");
    expect(body).toContain("Soft Concerns");
    expect(body).toContain("### Validation Results");
    expect(body).toContain("42 passed");
    expect(body).toContain("### Evidence");
    expect(body).toContain("factory evidence task-42");
    expect(body).toContain(
      "GET http://localhost:3000/api/tasks/task-42/evidence",
    );
  });

  it("includes protected surface edit warning when present", () => {
    const config = makeConfig({
      protectedSurfaceEdits: ["package.json", ".github/workflows/ci.yml"],
    });
    const body = generatePRBody(config, "http://localhost:3000");

    expect(body).toContain("### Protected Surface Edits");
    expect(body).toContain("`package.json`");
    expect(body).toContain("`.github/workflows/ci.yml`");
  });

  it("includes validator control file edit warning when present", () => {
    const config = makeConfig({
      validatorControlFileEdits: [
        { path: ".eslintrc.json", category: "linter" },
        { path: "tsconfig.json", category: "compiler" },
      ],
    });
    const body = generatePRBody(config, "http://localhost:3000");

    expect(body).toContain("### Validator Control File Edits");
    expect(body).toContain("modified files that influence validation behavior");
    expect(body).toContain("`.eslintrc.json` (linter)");
    expect(body).toContain("`tsconfig.json` (compiler)");
  });

  it("includes attempt number and base SHA in footer", () => {
    const config = makeConfig({
      attemptNumber: 3,
      headSha: "deadbeef1234567890",
    });
    const body = generatePRBody(config, "http://localhost:3000");

    expect(body).toContain("Attempt 3");
    expect(body).toContain("Base: `deadbee`");
  });
});

describe("buildPRTitle", () => {
  it("prefixes with 'factory: ' and truncates long objectives", () => {
    const title = buildPRTitle(
      "Implement the entire authentication system with OAuth2 integration and session management",
    );
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/^factory: /);
    expect(title).toMatch(/\.\.\.$/);
  });

  it("does not truncate short objectives", () => {
    const title = buildPRTitle("Fix login bug");
    expect(title).toBe("factory: Fix login bug");
    expect(title.length).toBeLessThanOrEqual(60);
  });
});
