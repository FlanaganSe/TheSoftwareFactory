import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialBroker } from "../../src/github/credential-broker.js";
import { createReviewTrackerActivities } from "../../src/github/review-tracker.js";

vi.mock("../../src/github/client.js", () => ({
  createRestClient: vi.fn(),
  createGraphQLClient: vi.fn(),
}));

import {
  createGraphQLClient,
  createRestClient,
} from "../../src/github/client.js";

function makeMockBroker(): CredentialBroker {
  return {
    getToken: vi.fn().mockResolvedValue("mock-token"),
    getTokenForState: vi.fn().mockResolvedValue("mock-token"),
  } as unknown as CredentialBroker;
}

describe("createReviewTrackerActivities", () => {
  let broker: CredentialBroker;
  let mockRest: {
    pulls: { get: ReturnType<typeof vi.fn> };
    checks: { listForRef: ReturnType<typeof vi.fn> };
  };
  let mockGraphQL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = makeMockBroker();

    mockRest = {
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            state: "open",
            merged: false,
            head: { sha: "abc123" },
          },
        }),
      },
      checks: {
        listForRef: vi.fn().mockResolvedValue({
          data: {
            check_runs: [
              { name: "ci/test", conclusion: "success" },
              { name: "ci/lint", conclusion: "success" },
            ],
          },
        }),
      },
    };

    vi.mocked(createRestClient).mockReturnValue(mockRest as never);

    mockGraphQL = vi.fn().mockResolvedValue({
      repository: {
        pullRequest: {
          reviewDecision: "APPROVED",
          reviews: {
            nodes: [{ state: "APPROVED", author: { login: "alice" } }],
          },
          reviewThreads: {
            nodes: [
              { isResolved: true, isOutdated: false },
              { isResolved: false, isOutdated: true }, // outdated, shouldn't count
            ],
          },
        },
      },
    });

    vi.mocked(createGraphQLClient).mockReturnValue(mockGraphQL as never);
  });

  describe("reconcilePRState", () => {
    it("reconciles open PR with approved reviews", async () => {
      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      const result = await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(result.isOk()).toBe(true);
      const state = result._unsafeUnwrap();
      expect(state.prState).toBe("open");
      expect(state.reviewDecision).toBe("APPROVED");
      expect(state.unresolvedThreads).toBe(0); // outdated thread excluded
      expect(state.staleReviews).toBe(false); // APPROVED means not stale
      expect(state.headSha).toBe("abc123");
      expect(state.checks).toHaveLength(2);
    });

    it("reconciles PR with changes_requested", async () => {
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "CHANGES_REQUESTED",
            reviews: {
              nodes: [{ state: "CHANGES_REQUESTED", author: { login: "bob" } }],
            },
            reviewThreads: { nodes: [] },
          },
        },
      });

      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      const result = await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(result.isOk()).toBe(true);
      const state = result._unsafeUnwrap();
      expect(state.reviewDecision).toBe("CHANGES_REQUESTED");
    });

    it("detects stale reviews when reviewDecision is REVIEW_REQUIRED", async () => {
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "REVIEW_REQUIRED",
            reviews: {
              nodes: [{ state: "APPROVED", author: { login: "alice" } }],
            },
            reviewThreads: { nodes: [] },
          },
        },
      });

      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      const result = await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(result.isOk()).toBe(true);
      const state = result._unsafeUnwrap();
      expect(state.staleReviews).toBe(true);
    });

    it("reconciles closed+merged PR", async () => {
      mockRest.pulls.get.mockResolvedValue({
        data: {
          state: "closed",
          merged: true,
          head: { sha: "def456" },
        },
      });

      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      const result = await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(result.isOk()).toBe(true);
      const state = result._unsafeUnwrap();
      expect(state.prState).toBe("merged");
      expect(state.headSha).toBe("def456");
    });

    it("reconciles with failed check", async () => {
      mockRest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [{ name: "ci/test", conclusion: "failure" }],
        },
      });

      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      const result = await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(result.isOk()).toBe(true);
      const state = result._unsafeUnwrap();
      expect(state.checks).toEqual([
        { name: "ci/test", conclusion: "failure" },
      ]);
    });

    it("counts unresolved threads correctly", async () => {
      mockGraphQL.mockResolvedValue({
        repository: {
          pullRequest: {
            reviewDecision: "APPROVED",
            reviews: { nodes: [] },
            reviewThreads: {
              nodes: [
                { isResolved: false, isOutdated: false }, // counts
                { isResolved: false, isOutdated: false }, // counts
                { isResolved: true, isOutdated: false }, // resolved, skip
                { isResolved: false, isOutdated: true }, // outdated, skip
              ],
            },
          },
        },
      });

      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      const result = await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().unresolvedThreads).toBe(2);
    });

    it("requests token scoped to pr_tracking phase", async () => {
      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(broker.getToken).toHaveBeenCalledWith("pr_tracking");
    });

    it("returns error on API failure", async () => {
      mockRest.pulls.get.mockRejectedValue(new Error("Network error"));

      const activities = createReviewTrackerActivities({
        credentialBroker: broker,
      });

      const result = await activities.reconcilePRState({
        owner: "test-org",
        repo: "test-repo",
        prNumber: 42,
      });

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("github_transient");
      expect(error.message).toContain("Network error");
    });
  });
});
