import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBranchActivities } from "../../src/github/branch.js";
import type { CredentialBroker } from "../../src/github/credential-broker.js";
import { MutationSerializer } from "../../src/github/rate-limiter.js";

vi.mock("../../src/github/client.js", () => ({
  createRestClient: vi.fn(),
}));

import { createRestClient } from "../../src/github/client.js";

function makeMockBroker(): CredentialBroker {
  return {
    getToken: vi.fn().mockResolvedValue("mock-token"),
    getTokenForState: vi.fn().mockResolvedValue("mock-token"),
  } as unknown as CredentialBroker;
}

function makeMockClient() {
  return {
    git: {
      createRef: vi.fn(),
      updateRef: vi.fn(),
      getCommit: vi.fn(),
      createBlob: vi.fn(),
      createTree: vi.fn(),
      createCommit: vi.fn(),
    },
  };
}

describe("createBranchActivities", () => {
  let broker: CredentialBroker;
  let serializer: MutationSerializer;
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = makeMockBroker();
    serializer = new MutationSerializer();
    // Speed up tests by making serializer a no-op
    vi.spyOn(serializer, "waitForSlot").mockResolvedValue(undefined);
    mockClient = makeMockClient();
    vi.mocked(createRestClient).mockReturnValue(mockClient as never);
  });

  describe("createCandidateBranch", () => {
    it("creates a new branch ref", async () => {
      const activities = createBranchActivities({
        credentialBroker: broker,
        serializer,
      });

      mockClient.git.createRef.mockResolvedValue({
        data: { ref: "refs/heads/factory/task-1", object: { sha: "abc123" } },
      });

      const result = await activities.createCandidateBranch(
        "owner",
        "repo",
        "factory/task-1",
        "abc123",
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        ref: "refs/heads/factory/task-1",
        sha: "abc123",
      });

      expect(mockClient.git.createRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "refs/heads/factory/task-1",
        sha: "abc123",
      });
    });

    it("updates existing branch if 422 returned", async () => {
      const activities = createBranchActivities({
        credentialBroker: broker,
        serializer,
      });

      mockClient.git.createRef.mockRejectedValue({
        status: 422,
        message: "Reference already exists",
      });
      mockClient.git.updateRef.mockResolvedValue({
        data: { ref: "refs/heads/factory/task-1", object: { sha: "abc123" } },
      });

      const result = await activities.createCandidateBranch(
        "owner",
        "repo",
        "factory/task-1",
        "abc123",
      );

      expect(result.isOk()).toBe(true);
      expect(mockClient.git.updateRef).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        ref: "heads/factory/task-1",
        sha: "abc123",
        force: true,
      });
    });

    it("uses MutationSerializer for rate limiting", async () => {
      const activities = createBranchActivities({
        credentialBroker: broker,
        serializer,
      });

      mockClient.git.createRef.mockResolvedValue({
        data: {
          ref: "refs/heads/factory/task-1",
          object: { sha: "abc123" },
        },
      });

      await activities.createCandidateBranch(
        "owner",
        "repo",
        "factory/task-1",
        "abc123",
      );

      expect(serializer.waitForSlot).toHaveBeenCalled();
    });
  });

  describe("pushChanges", () => {
    it("executes the 6-step Git Database API sequence", async () => {
      const activities = createBranchActivities({
        credentialBroker: broker,
        serializer,
      });

      mockClient.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "tree-sha-1" } },
      });
      mockClient.git.createBlob.mockResolvedValue({
        data: { sha: "blob-sha-1" },
      });
      mockClient.git.createTree.mockResolvedValue({
        data: { sha: "new-tree-sha" },
      });
      mockClient.git.createCommit.mockResolvedValue({
        data: { sha: "new-commit-sha" },
      });
      mockClient.git.updateRef.mockResolvedValue({
        data: { ref: "refs/heads/factory/task-1" },
      });

      const result = await activities.pushChanges(
        "owner",
        "repo",
        "factory/task-1",
        "parent-sha",
        [
          {
            path: "src/index.ts",
            content: "console.log('hello')",
            mode: "100644",
          },
        ],
        "factory: add hello world",
      );

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ commitSha: "new-commit-sha" });

      // Verify all 5 API calls were made (step 1 is getCommit, not getRef)
      expect(mockClient.git.getCommit).toHaveBeenCalledTimes(1);
      expect(mockClient.git.createBlob).toHaveBeenCalledTimes(1);
      expect(mockClient.git.createTree).toHaveBeenCalledTimes(1);
      expect(mockClient.git.createCommit).toHaveBeenCalledTimes(1);
      expect(mockClient.git.updateRef).toHaveBeenCalledTimes(1);
    });

    it("creates blobs for multiple file changes", async () => {
      const activities = createBranchActivities({
        credentialBroker: broker,
        serializer,
      });

      mockClient.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "tree-sha-1" } },
      });
      mockClient.git.createBlob
        .mockResolvedValueOnce({ data: { sha: "blob-1" } })
        .mockResolvedValueOnce({ data: { sha: "blob-2" } })
        .mockResolvedValueOnce({ data: { sha: "blob-3" } });
      mockClient.git.createTree.mockResolvedValue({
        data: { sha: "new-tree" },
      });
      mockClient.git.createCommit.mockResolvedValue({
        data: { sha: "new-commit" },
      });
      mockClient.git.updateRef.mockResolvedValue({
        data: { ref: "refs/heads/factory/task-1" },
      });

      const changes = [
        { path: "a.ts", content: "a", mode: "100644" as const },
        { path: "b.ts", content: "b", mode: "100644" as const },
        { path: "c.sh", content: "c", mode: "100755" as const },
      ];

      const result = await activities.pushChanges(
        "owner",
        "repo",
        "factory/task-1",
        "parent-sha",
        changes,
        "factory: multi-file change",
      );

      expect(result.isOk()).toBe(true);
      expect(mockClient.git.createBlob).toHaveBeenCalledTimes(3);
    });

    it("does not provide custom author (auto-signed by App)", async () => {
      const activities = createBranchActivities({
        credentialBroker: broker,
        serializer,
      });

      mockClient.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "tree-sha-1" } },
      });
      mockClient.git.createBlob.mockResolvedValue({
        data: { sha: "blob-1" },
      });
      mockClient.git.createTree.mockResolvedValue({
        data: { sha: "new-tree" },
      });
      mockClient.git.createCommit.mockResolvedValue({
        data: { sha: "new-commit" },
      });
      mockClient.git.updateRef.mockResolvedValue({
        data: { ref: "refs/heads/b" },
      });

      await activities.pushChanges(
        "owner",
        "repo",
        "b",
        "parent",
        [{ path: "f.ts", content: "x", mode: "100644" }],
        "msg",
      );

      const commitCall = mockClient.git.createCommit.mock.calls[0][0];
      expect(commitCall).not.toHaveProperty("author");
      expect(commitCall).not.toHaveProperty("committer");
    });

    it("enforces 1s serialization between mutations", async () => {
      const activities = createBranchActivities({
        credentialBroker: broker,
        serializer,
      });

      mockClient.git.getCommit.mockResolvedValue({
        data: { tree: { sha: "tree" } },
      });
      mockClient.git.createBlob.mockResolvedValue({
        data: { sha: "blob" },
      });
      mockClient.git.createTree.mockResolvedValue({
        data: { sha: "tree2" },
      });
      mockClient.git.createCommit.mockResolvedValue({
        data: { sha: "commit" },
      });
      mockClient.git.updateRef.mockResolvedValue({
        data: { ref: "refs/heads/b" },
      });

      await activities.pushChanges(
        "owner",
        "repo",
        "b",
        "parent",
        [{ path: "f.ts", content: "x", mode: "100644" }],
        "msg",
      );

      // 1 blob + 1 createTree + 1 createCommit + 1 updateRef = 4 mutations
      expect(serializer.waitForSlot).toHaveBeenCalledTimes(4);
    });
  });
});
