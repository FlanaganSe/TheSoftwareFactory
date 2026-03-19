import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialBroker } from "../../src/github/credential-broker.js";
import {
  type MergeActivityDeps,
  type SideEffectOps,
  computeMergeIdempotencyKey,
  createMergeActivities,
} from "../../src/github/merge.js";
import { MutationSerializer } from "../../src/github/rate-limiter.js";

vi.mock("../../src/github/client.js", () => ({
  createRestClient: vi.fn(),
  createGraphQLClient: vi.fn(),
}));

import {
  createGraphQLClient,
  createRestClient,
} from "../../src/github/client.js";

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
    pulls: {
      get: vi.fn(),
      merge: vi.fn(),
    },
    checks: {
      listForRef: vi.fn(),
    },
    git: {
      deleteRef: vi.fn(),
    },
  };
}

function makeDeps(overrides?: Partial<MergeActivityDeps>): MergeActivityDeps {
  const broker = makeMockBroker();
  const serializer = new MutationSerializer();
  vi.spyOn(serializer, "waitForSlot").mockResolvedValue(undefined);
  return {
    credentialBroker: broker,
    serializer,
    sideEffects: makeMockSideEffects(),
    ...overrides,
  };
}

describe("createMergeActivities", () => {
  let mockClient: ReturnType<typeof makeMockClient>;
  let mockGraphQL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = makeMockClient();
    mockGraphQL = vi.fn().mockResolvedValue({});
    vi.mocked(createRestClient).mockReturnValue(mockClient as never);
    vi.mocked(createGraphQLClient).mockReturnValue(mockGraphQL as never);
  });

  // ─── checkMergeReadiness ───

  describe("checkMergeReadiness", () => {
    const basePrecheckConfig = {
      owner: "test-org",
      repo: "test-repo",
      prNumber: 42,
      expectedHeadSha: "abc123",
      requiredChecks: ["ci/test"],
      requiredReviewCount: 1,
    };

    it("returns ready when all checks pass and reviews approved", async () => {
      mockClient.pulls.get.mockResolvedValue({
        data: {
          state: "open",
          head: { sha: "abc123" },
          mergeable: true,
          mergeable_state: "clean",
        },
      });
      mockClient.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { name: "ci/test", conclusion: "success", status: "completed" },
          ],
        },
      });
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "APPROVED",
            reviewThreads: { nodes: [] },
          },
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.checkMergeReadiness(basePrecheckConfig);

      expect(result.isOk()).toBe(true);
      const precheck = result._unsafeUnwrap();
      expect(precheck.ready).toBe(true);
      expect(precheck.blockers).toHaveLength(0);
      expect(precheck.checksStatus).toBe("all_passing");
      expect(precheck.reviewStatus).toBe("approved");
    });

    it("returns not ready when a required check is failing", async () => {
      mockClient.pulls.get.mockResolvedValue({
        data: {
          state: "open",
          head: { sha: "abc123" },
          mergeable: true,
        },
      });
      mockClient.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { name: "ci/test", conclusion: "failure", status: "completed" },
          ],
        },
      });
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "APPROVED",
            reviewThreads: { nodes: [] },
          },
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.checkMergeReadiness(basePrecheckConfig);

      expect(result.isOk()).toBe(true);
      const precheck = result._unsafeUnwrap();
      expect(precheck.ready).toBe(false);
      expect(precheck.blockers).toContain(
        'Required check "ci/test" is failure',
      );
      expect(precheck.checksStatus).toBe("some_failing");
    });

    it("returns not ready when reviews are pending", async () => {
      mockClient.pulls.get.mockResolvedValue({
        data: {
          state: "open",
          head: { sha: "abc123" },
          mergeable: true,
        },
      });
      mockClient.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { name: "ci/test", conclusion: "success", status: "completed" },
          ],
        },
      });
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "REVIEW_REQUIRED",
            reviewThreads: { nodes: [] },
          },
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.checkMergeReadiness(basePrecheckConfig);

      const precheck = result._unsafeUnwrap();
      expect(precheck.ready).toBe(false);
      expect(precheck.reviewStatus).toBe("pending");
      expect(precheck.blockers).toContain("Required reviews not yet provided");
    });

    it("returns not ready when HEAD SHA mismatches", async () => {
      mockClient.pulls.get.mockResolvedValue({
        data: {
          state: "open",
          head: { sha: "different-sha" },
          mergeable: true,
        },
      });
      mockClient.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "APPROVED",
            reviewThreads: { nodes: [] },
          },
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.checkMergeReadiness(basePrecheckConfig);

      const precheck = result._unsafeUnwrap();
      expect(precheck.ready).toBe(false);
      expect(
        precheck.blockers.some((b) => b.includes("HEAD SHA mismatch")),
      ).toBe(true);
    });

    it("returns not ready when PR is not open", async () => {
      mockClient.pulls.get.mockResolvedValue({
        data: {
          state: "closed",
          head: { sha: "abc123" },
          mergeable: false,
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.checkMergeReadiness(basePrecheckConfig);

      const precheck = result._unsafeUnwrap();
      expect(precheck.ready).toBe(false);
      expect(precheck.blockers).toContain("PR is closed, not open");
    });

    it("returns not ready when mergeable is null (computing)", async () => {
      mockClient.pulls.get.mockResolvedValue({
        data: {
          state: "open",
          head: { sha: "abc123" },
          mergeable: null,
        },
      });
      mockClient.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { name: "ci/test", conclusion: "success", status: "completed" },
          ],
        },
      });
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "APPROVED",
            reviewThreads: { nodes: [] },
          },
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.checkMergeReadiness(basePrecheckConfig);

      const precheck = result._unsafeUnwrap();
      expect(precheck.ready).toBe(false);
      expect(precheck.blockers).toContain(
        "Merge status pending (GitHub still computing)",
      );
    });

    it("returns not ready when unresolved review threads exist", async () => {
      mockClient.pulls.get.mockResolvedValue({
        data: {
          state: "open",
          head: { sha: "abc123" },
          mergeable: true,
        },
      });
      mockClient.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { name: "ci/test", conclusion: "success", status: "completed" },
          ],
        },
      });
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "APPROVED",
            reviewThreads: {
              nodes: [
                { isResolved: false, isOutdated: false },
                { isResolved: true, isOutdated: false },
              ],
            },
          },
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.checkMergeReadiness(basePrecheckConfig);

      const precheck = result._unsafeUnwrap();
      expect(precheck.ready).toBe(false);
      expect(precheck.threadsStatus).toBe("unresolved");
      expect(precheck.blockers).toContain("1 unresolved review thread(s)");
    });
  });

  // ─── mergePullRequest ───

  describe("mergePullRequest", () => {
    const baseMergeConfig = {
      owner: "test-org",
      repo: "test-repo",
      prNumber: 42,
      prNodeId: "PR_node_42",
      expectedHeadSha: "abc123",
      mergeMethod: "squash" as const,
      commitTitle: "factory: Add feature (#42)",
      useMergeQueue: false,
      taskId: "task-1",
    };

    it("direct merge success returns merged: true with sha", async () => {
      mockClient.pulls.merge.mockResolvedValue({
        data: {
          merged: true,
          sha: "merge-sha-123",
          message: "Pull Request successfully merged",
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.mergePullRequest(baseMergeConfig);

      expect(result.isOk()).toBe(true);
      const mergeResult = result._unsafeUnwrap();
      expect(mergeResult.merged).toBe(true);
      expect(mergeResult.sha).toBe("merge-sha-123");
      expect(mergeResult.method).toBe("squash");
    });

    it("direct merge 409 SHA conflict returns merged: false", async () => {
      const error = Object.assign(new Error("Head branch was modified"), {
        status: 409,
      });
      mockClient.pulls.merge.mockRejectedValue(error);

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.mergePullRequest(baseMergeConfig);

      expect(result.isOk()).toBe(true);
      const mergeResult = result._unsafeUnwrap();
      expect(mergeResult.merged).toBe(false);
      expect(mergeResult.message).toContain("Head branch was modified");
    });

    it("direct merge 405 not allowed returns merged: false", async () => {
      const error = Object.assign(new Error("merge not allowed"), {
        status: 405,
      });
      mockClient.pulls.merge.mockRejectedValue(error);

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.mergePullRequest(baseMergeConfig);

      expect(result.isOk()).toBe(true);
      const mergeResult = result._unsafeUnwrap();
      expect(mergeResult.merged).toBe(false);
    });

    it("merge queue path enqueues and returns position", async () => {
      mockGraphQL.mockResolvedValue({
        enqueuePullRequest: {
          mergeQueueEntry: { position: 3 },
        },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.mergePullRequest({
        ...baseMergeConfig,
        useMergeQueue: true,
      });

      expect(result.isOk()).toBe(true);
      const mergeResult = result._unsafeUnwrap();
      expect(mergeResult.merged).toBe(false);
      expect(mergeResult.method).toBe("merge_queue");
      expect(mergeResult.mergeQueuePosition).toBe(3);
    });

    it("merge method selection: squash is used when specified", async () => {
      mockClient.pulls.merge.mockResolvedValue({
        data: { merged: true, sha: "sha-1", message: "ok" },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      await activities.mergePullRequest({
        ...baseMergeConfig,
        mergeMethod: "squash",
      });

      expect(mockClient.pulls.merge).toHaveBeenCalledWith(
        expect.objectContaining({ merge_method: "squash" }),
      );
    });

    it("merge method selection: rebase is used when specified", async () => {
      mockClient.pulls.merge.mockResolvedValue({
        data: { merged: true, sha: "sha-1", message: "ok" },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      await activities.mergePullRequest({
        ...baseMergeConfig,
        mergeMethod: "rebase",
      });

      expect(mockClient.pulls.merge).toHaveBeenCalledWith(
        expect.objectContaining({ merge_method: "rebase" }),
      );
    });

    it("side-effect idempotency: completed merge returns cached result", async () => {
      const sideEffects = makeMockSideEffects();
      vi.mocked(sideEffects.getSideEffect).mockResolvedValue(
        ok({
          status: "completed",
          responsePayload: {
            merged: true,
            sha: "cached-sha",
            method: "squash",
            message: "Cached merge",
          },
        }),
      );

      const deps = makeDeps({ sideEffects });
      const activities = createMergeActivities(deps);
      const result = await activities.mergePullRequest(baseMergeConfig);

      expect(result.isOk()).toBe(true);
      const mergeResult = result._unsafeUnwrap();
      expect(mergeResult.merged).toBe(true);
      expect(mergeResult.sha).toBe("cached-sha");
      // No API call made
      expect(mockClient.pulls.merge).not.toHaveBeenCalled();
    });

    it("uses merge phase token scoping", async () => {
      mockClient.pulls.merge.mockResolvedValue({
        data: { merged: true, sha: "sha-1", message: "ok" },
      });

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      await activities.mergePullRequest(baseMergeConfig);

      expect(deps.credentialBroker.getToken).toHaveBeenCalledWith("merge");
    });

    it("direct merge 422 validation failure returns merged: false", async () => {
      const error = Object.assign(new Error("validation failed"), {
        status: 422,
      });
      mockClient.pulls.merge.mockRejectedValue(error);

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.mergePullRequest(baseMergeConfig);

      expect(result.isOk()).toBe(true);
      const mergeResult = result._unsafeUnwrap();
      expect(mergeResult.merged).toBe(false);
    });
  });

  // ─── deleteBranch ───

  describe("deleteBranch", () => {
    it("deletes branch with correct API call", async () => {
      mockClient.git.deleteRef.mockResolvedValue({});

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.deleteBranch(
        "test-org",
        "test-repo",
        "factory/task-42",
      );

      expect(result.isOk()).toBe(true);
      expect(mockClient.git.deleteRef).toHaveBeenCalledWith({
        owner: "test-org",
        repo: "test-repo",
        ref: "heads/factory/task-42",
      });
    });

    it("handles already deleted branch (422) gracefully", async () => {
      const error = Object.assign(new Error("Reference does not exist"), {
        status: 422,
      });
      mockClient.git.deleteRef.mockRejectedValue(error);

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.deleteBranch(
        "test-org",
        "test-repo",
        "factory/task-42",
      );

      expect(result.isOk()).toBe(true);
    });

    it("branch delete failure is non-blocking", async () => {
      mockClient.git.deleteRef.mockRejectedValue(new Error("Network error"));

      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.deleteBranch(
        "test-org",
        "test-repo",
        "factory/task-42",
      );

      // Non-blocking — returns ok even on error
      expect(result.isOk()).toBe(true);
    });

    it("refuses to delete non-factory branches", async () => {
      const deps = makeDeps();
      const activities = createMergeActivities(deps);
      const result = await activities.deleteBranch(
        "test-org",
        "test-repo",
        "main",
      );

      expect(result.isErr()).toBe(true);
      expect(mockClient.git.deleteRef).not.toHaveBeenCalled();
    });
  });

  // ─── Idempotency key ───

  describe("computeMergeIdempotencyKey", () => {
    it("produces deterministic keys", () => {
      const key1 = computeMergeIdempotencyKey("task-1", 42, "abc123");
      const key2 = computeMergeIdempotencyKey("task-1", 42, "abc123");
      expect(key1).toBe(key2);
    });

    it("produces different keys for different inputs", () => {
      const key1 = computeMergeIdempotencyKey("task-1", 42, "abc123");
      const key2 = computeMergeIdempotencyKey("task-1", 42, "def456");
      expect(key1).not.toBe(key2);
    });
  });
});
