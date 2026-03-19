import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAutoMergeActivities } from "../../src/github/auto-merge.js";
import type { CredentialBroker } from "../../src/github/credential-broker.js";
import { MutationSerializer } from "../../src/github/rate-limiter.js";

vi.mock("../../src/github/client.js", () => ({
  createGraphQLClient: vi.fn(),
}));

import { createGraphQLClient } from "../../src/github/client.js";

function makeMockBroker(): CredentialBroker {
  return {
    getToken: vi.fn().mockResolvedValue("mock-token"),
    getTokenForState: vi.fn().mockResolvedValue("mock-token"),
  } as unknown as CredentialBroker;
}

describe("createAutoMergeActivities", () => {
  let broker: CredentialBroker;
  let serializer: MutationSerializer;
  let mockGraphQL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = makeMockBroker();
    serializer = new MutationSerializer();
    vi.spyOn(serializer, "waitForSlot").mockResolvedValue(undefined);
    mockGraphQL = vi.fn().mockResolvedValue({});
    vi.mocked(createGraphQLClient).mockReturnValue(mockGraphQL as never);
  });

  describe("enableAutoMerge", () => {
    it("calls the correct GraphQL mutation with prNodeId and mergeMethod", async () => {
      const activities = createAutoMergeActivities({
        credentialBroker: broker,
        serializer,
      });

      const result = await activities.enableAutoMerge(
        "owner",
        "repo",
        "PR_node_id_123",
        "SQUASH",
      );

      expect(result.isOk()).toBe(true);
      expect(mockGraphQL).toHaveBeenCalledOnce();

      const [mutation, variables] = mockGraphQL.mock.calls[0];
      expect(mutation).toContain("enablePullRequestAutoMerge");
      expect(variables).toEqual({
        prId: "PR_node_id_123",
        mergeMethod: "SQUASH",
      });
    });

    it("returns err with github_transient on GraphQL error", async () => {
      mockGraphQL.mockRejectedValue(new Error("GraphQL request failed"));

      const activities = createAutoMergeActivities({
        credentialBroker: broker,
        serializer,
      });

      const result = await activities.enableAutoMerge(
        "owner",
        "repo",
        "PR_node_id_123",
        "MERGE",
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("github_transient");
      expect(error.message).toContain("Failed to enable auto-merge");
      expect(error.message).toContain("GraphQL request failed");
    });
  });

  describe("enqueuePullRequest", () => {
    it("calls the correct GraphQL mutation with prNodeId", async () => {
      const activities = createAutoMergeActivities({
        credentialBroker: broker,
        serializer,
      });

      const result = await activities.enqueuePullRequest(
        "owner",
        "repo",
        "PR_node_id_456",
      );

      expect(result.isOk()).toBe(true);
      expect(mockGraphQL).toHaveBeenCalledOnce();

      const [mutation, variables] = mockGraphQL.mock.calls[0];
      expect(mutation).toContain("enqueuePullRequest");
      expect(variables).toEqual({ prId: "PR_node_id_456" });
    });

    it("returns err with github_transient on GraphQL error", async () => {
      mockGraphQL.mockRejectedValue(new Error("Network timeout"));

      const activities = createAutoMergeActivities({
        credentialBroker: broker,
        serializer,
      });

      const result = await activities.enqueuePullRequest(
        "owner",
        "repo",
        "PR_node_id_456",
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe("github_transient");
      expect(error.message).toContain("Failed to enqueue PR");
      expect(error.message).toContain("Network timeout");
    });
  });

  describe("serialization and token scoping", () => {
    it("calls serializer.waitForSlot before GraphQL mutations", async () => {
      const callOrder: string[] = [];

      vi.mocked(serializer.waitForSlot).mockImplementation(async () => {
        callOrder.push("waitForSlot");
      });
      mockGraphQL.mockImplementation(async () => {
        callOrder.push("graphql");
        return {};
      });

      const activities = createAutoMergeActivities({
        credentialBroker: broker,
        serializer,
      });

      await activities.enableAutoMerge("owner", "repo", "PR_1", "SQUASH");

      expect(callOrder).toEqual(["waitForSlot", "graphql"]);

      callOrder.length = 0;

      await activities.enqueuePullRequest("owner", "repo", "PR_2");

      expect(callOrder).toEqual(["waitForSlot", "graphql"]);
    });

    it("requests a token scoped to the pr_creation phase", async () => {
      const activities = createAutoMergeActivities({
        credentialBroker: broker,
        serializer,
      });

      await activities.enableAutoMerge("owner", "repo", "PR_1", "MERGE");

      expect(broker.getToken).toHaveBeenCalledWith("pr_creation");

      vi.mocked(broker.getToken).mockClear();

      await activities.enqueuePullRequest("owner", "repo", "PR_2");

      expect(broker.getToken).toHaveBeenCalledWith("pr_creation");
    });
  });
});
