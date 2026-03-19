import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchWebhookToWorkflow } from "../src/webhooks/dispatcher.js";

// Mock the DB module
vi.mock("@software-factory/db", () => ({
  reviewStateRepo: {
    getReviewStateByPrNumber: vi.fn(),
  },
}));

import { reviewStateRepo } from "@software-factory/db";

function makeClient(
  overrides: {
    signal?: ReturnType<typeof vi.fn>;
  } = {},
): { workflow: { getHandle: ReturnType<typeof vi.fn> } } {
  const signal = overrides.signal ?? vi.fn().mockResolvedValue(undefined);
  return {
    workflow: {
      getHandle: vi.fn().mockReturnValue({ signal }),
    },
  };
}

// Minimal mock of neverthrow's Ok result — satisfies runtime checks
function okResult(value: unknown) {
  return { isOk: () => true, isErr: () => false, value } as never;
}

function makePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    repository: { full_name: "test-org/test-repo" },
    ...overrides,
  };
}

describe("dispatchWebhookToWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: review state found
    vi.mocked(reviewStateRepo.getReviewStateByPrNumber).mockResolvedValue(
      okResult({
        id: "rs-1",
        taskId: "task-1",
        prNumber: 42,
        prUrl: "https://github.com/test-org/test-repo/pull/42",
        prNodeId: "PR_node_42",
        headSha: "abc123",
        mergeQueueStatus: "none",
        evidenceBundleId: null,
        internalApprovedBy: null,
        internalApprovedAt: null,
        requiredChecks: null,
        codeownersStatus: null,
        unresolvedThreads: 0,
        staleReviews: false,
        lastGithubSync: null,
        githubReconciliationData: null,
      }),
    );
  });

  it("dispatches prClosedSignal on pull_request.closed (merged=true)", async () => {
    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 42, merged: true },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request",
      "closed",
      payload,
    );

    expect(result.dispatched).toBe(true);
    expect(result.signalName).toBe("pr_closed");
    expect(client.workflow.getHandle).toHaveBeenCalledWith("task-task-1");
    const signal = client.workflow.getHandle().signal;
    expect(signal).toHaveBeenCalledWith("pr_closed", { merged: true });
  });

  it("dispatches prClosedSignal on pull_request.closed (merged=false)", async () => {
    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 42, merged: false },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request",
      "closed",
      payload,
    );

    expect(result.dispatched).toBe(true);
    const signal = client.workflow.getHandle().signal;
    expect(signal).toHaveBeenCalledWith("pr_closed", { merged: false });
  });

  it("dispatches prReviewSignal on pull_request_review.submitted (approved)", async () => {
    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 42 },
      review: { state: "APPROVED", user: { login: "alice" } },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request_review",
      "submitted",
      payload,
    );

    expect(result.dispatched).toBe(true);
    expect(result.signalName).toBe("pr_review");
    const signal = client.workflow.getHandle().signal;
    expect(signal).toHaveBeenCalledWith("pr_review", {
      action: "submitted",
      state: "approved",
      reviewer: "alice",
    });
  });

  it("dispatches prReviewSignal on pull_request_review.submitted (changes_requested)", async () => {
    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 42 },
      review: { state: "CHANGES_REQUESTED", user: { login: "bob" } },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request_review",
      "submitted",
      payload,
    );

    expect(result.dispatched).toBe(true);
    const signal = client.workflow.getHandle().signal;
    expect(signal).toHaveBeenCalledWith("pr_review", {
      action: "submitted",
      state: "changes_requested",
      reviewer: "bob",
    });
  });

  it("dispatches prReviewSignal on pull_request_review.dismissed", async () => {
    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 42 },
      review: { state: "APPROVED", user: { login: "alice" } },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request_review",
      "dismissed",
      payload,
    );

    expect(result.dispatched).toBe(true);
    const signal = client.workflow.getHandle().signal;
    expect(signal).toHaveBeenCalledWith("pr_review", {
      action: "dismissed",
      state: "dismissed",
      reviewer: "alice",
    });
  });

  it("dispatches checkCompleteSignal on check_suite.completed", async () => {
    const client = makeClient();
    const payload = makePayload({
      check_suite: {
        app: { name: "GitHub Actions" },
        conclusion: "success",
        pull_requests: [{ number: 42 }],
      },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "check_suite",
      "completed",
      payload,
    );

    expect(result.dispatched).toBe(true);
    expect(result.signalName).toBe("check_complete");
  });

  it("dispatches checkCompleteSignal on check_run.completed", async () => {
    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 42 },
      check_run: {
        name: "ci/test",
        conclusion: "failure",
        pull_requests: [{ number: 42 }],
      },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "check_run",
      "completed",
      payload,
    );

    expect(result.dispatched).toBe(true);
    expect(result.signalName).toBe("check_complete");
    const signal = client.workflow.getHandle().signal;
    expect(signal).toHaveBeenCalledWith("check_complete", {
      checkName: "ci/test",
      conclusion: "failure",
    });
  });

  it("dispatches mergeQueueUpdateSignal on merge_group.checks_requested", async () => {
    const client = makeClient();
    const payload = makePayload({
      merge_group: {
        head_ref: "gh-readonly-queue/main/pr-42-abc123",
      },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "merge_group",
      "checks_requested",
      payload,
    );

    expect(result.dispatched).toBe(true);
    expect(result.signalName).toBe("merge_queue_update");
    const signal = client.workflow.getHandle().signal;
    expect(signal).toHaveBeenCalledWith("merge_queue_update", {
      status: "checks_requested",
    });
  });

  it("skips dispatch for non-factory PR", async () => {
    vi.mocked(reviewStateRepo.getReviewStateByPrNumber).mockResolvedValue(
      okResult(null),
    );

    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 99 },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request",
      "closed",
      payload,
    );

    expect(result.dispatched).toBe(false);
    expect(client.workflow.getHandle).not.toHaveBeenCalled();
  });

  it("skips dispatch when workflow is not found", async () => {
    const client = {
      workflow: {
        getHandle: vi.fn().mockReturnValue({
          signal: vi.fn().mockRejectedValue(new Error("Workflow not found")),
        }),
      },
    };

    const payload = makePayload({
      pull_request: { number: 42, merged: true },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request",
      "closed",
      payload,
    );

    // Catches the error and returns not dispatched
    expect(result.dispatched).toBe(false);
  });

  it("extracts PR number correctly from check_suite", async () => {
    const client = makeClient();
    const payload = makePayload({
      check_suite: {
        app: { name: "CI" },
        conclusion: "success",
        pull_requests: [{ number: 42 }, { number: 43 }],
      },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "check_suite",
      "completed",
      payload,
    );

    expect(result.dispatched).toBe(true);
  });

  it("skips dispatch when no repository in payload", async () => {
    const client = makeClient();
    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request",
      "closed",
      { pull_request: { number: 42 } },
    );

    expect(result.dispatched).toBe(false);
  });

  it("does not dispatch on pull_request.synchronize", async () => {
    const client = makeClient();
    const payload = makePayload({
      pull_request: { number: 42 },
    });

    const result = await dispatchWebhookToWorkflow(
      client as never,
      {} as never,
      "pull_request",
      "synchronize",
      payload,
    );

    expect(result.dispatched).toBe(false);
  });
});
