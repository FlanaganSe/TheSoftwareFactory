import { describe, expect, it, vi } from "vitest";
import {
  type BroadReconcilerConfig,
  createBroadReconciler,
} from "../../src/github/reconciler.js";

// Mock the GitHub clients
vi.mock("../../src/github/client.js", () => ({
  createRestClient: vi.fn(() => ({
    repos: {
      get: vi.fn().mockResolvedValue({
        data: { default_branch: "main", visibility: "private" },
      }),
    },
  })),
  createGraphQLClient: vi.fn(() =>
    vi.fn().mockResolvedValue({
      repository: {
        pullRequest: {
          state: "OPEN",
          merged: false,
          reviewDecision: "APPROVED",
          headRefOid: "abc123",
          reviewThreads: { nodes: [] },
        },
      },
    }),
  ),
}));

function createMockDb() {
  // The mock handles two query patterns:
  // 1. db.select().from().innerJoin().innerJoin().where() — for active PRs
  // 2. db.select().from() — for repo metadata (must be awaitable)
  //
  // Drizzle's from() returns a query builder that is also a PromiseLike.
  // We simulate this by wrapping from() results in a Proxy that forwards
  // .innerJoin/.where AND is awaitable (via [Symbol.thennable] pattern).

  let fromResolveOverride: unknown[] | null = null;
  const whereResult = vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]);

  const chainMethods = {
    innerJoin: vi.fn().mockReturnThis(),
    where: whereResult,
  };

  const fromFn = vi.fn().mockImplementation(() => {
    if (fromResolveOverride !== null) {
      const data = fromResolveOverride;
      fromResolveOverride = null;
      return Object.assign(Promise.resolve(data), chainMethods);
    }
    return Object.assign(Promise.resolve([]), chainMethods);
  });

  return {
    select: vi.fn().mockReturnValue({ from: fromFn }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    _setWhereResult(data: unknown[]) {
      whereResult.mockResolvedValueOnce(data);
    },
    _setFromResult(data: unknown[]) {
      fromResolveOverride = data;
    },
  };
}

function createMockCredentialBroker() {
  return {
    getToken: vi.fn().mockResolvedValue("mock-token"),
    revokeToken: vi.fn(),
    getAppId: vi.fn().mockReturnValue("app-123"),
  };
}

describe("broad reconciler", () => {
  it("reconcileActivePRs returns empty report when no active PRs", async () => {
    const mockDb = createMockDb();
    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileActivePRs();

    expect(result.activePRsChecked).toBe(0);
    expect(result.driftDetected).toBe(0);
    expect(result.staleDetected).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("reconcileActivePRs does not make API calls when no active PRs", async () => {
    const mockDb = createMockDb();
    const mockCredBroker = createMockCredentialBroker();
    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: mockCredBroker as any,
    };

    const reconciler = createBroadReconciler(config);
    await reconciler.reconcileActivePRs();

    // Should not request a token if there are no PRs to check
    expect(mockCredBroker.getToken).not.toHaveBeenCalled();
  });

  it("reconcileActivePRs detects head SHA drift", async () => {
    const mockDb = createMockDb();
    mockDb._setWhereResult([
      {
        taskId: "task-1",
        prNumber: 42,
        headSha: "old-sha",
        owner: "testorg",
        repo: "testrepo",
      },
    ]);

    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    // The mock GraphQL returns headRefOid: "abc123" which differs from "old-sha"
    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileActivePRs();

    expect(result.activePRsChecked).toBe(1);
    expect(result.driftDetected).toBe(1);
  });

  it("reconcileActivePRs detects merged PRs", async () => {
    const { createGraphQLClient } = await import("../../src/github/client.js");
    vi.mocked(createGraphQLClient).mockReturnValueOnce(
      vi.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            state: "MERGED",
            merged: true,
            reviewDecision: "APPROVED",
            headRefOid: "abc123",
            reviewThreads: { nodes: [] },
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
      }) as any,
    );

    const mockDb = createMockDb();
    mockDb._setWhereResult([
      {
        taskId: "task-2",
        prNumber: 43,
        headSha: "abc123",
        owner: "testorg",
        repo: "testrepo",
      },
    ]);

    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileActivePRs();

    expect(result.driftDetected).toBeGreaterThanOrEqual(1);
  });

  it("reconcileActivePRs counts stale reviews", async () => {
    const { createGraphQLClient } = await import("../../src/github/client.js");
    vi.mocked(createGraphQLClient).mockReturnValueOnce(
      vi.fn().mockResolvedValue({
        repository: {
          pullRequest: {
            state: "OPEN",
            merged: false,
            reviewDecision: "REVIEW_REQUIRED",
            headRefOid: "abc123",
            reviewThreads: { nodes: [] },
          },
        },
        // biome-ignore lint/suspicious/noExplicitAny: test mock
      }) as any,
    );

    const mockDb = createMockDb();
    mockDb._setWhereResult([
      {
        taskId: "task-3",
        prNumber: 44,
        headSha: "abc123",
        owner: "testorg",
        repo: "testrepo",
      },
    ]);

    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileActivePRs();

    expect(result.staleDetected).toBe(1);
  });

  it("reconcileActivePRs handles API errors gracefully", async () => {
    const { createGraphQLClient } = await import("../../src/github/client.js");
    vi.mocked(createGraphQLClient).mockReturnValueOnce(
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      vi.fn().mockRejectedValue(new Error("GraphQL rate limited")) as any,
    );

    const mockDb = createMockDb();
    mockDb._setWhereResult([
      {
        taskId: "task-4",
        prNumber: 45,
        headSha: "abc123",
        owner: "testorg",
        repo: "testrepo",
      },
    ]);

    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileActivePRs();

    expect(result.errors).toHaveLength(1);
    expect((result.errors ?? [])[0]).toContain("GraphQL rate limited");
  });

  it("reconcileAll produces a complete report", async () => {
    const mockDb = createMockDb();
    // Both reconcileActivePRs and reconcileRepositoryMetadata will call select().from()
    // Default mock already returns empty arrays for both patterns

    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileAll();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.value.activePRsChecked).toBe("number");
      expect(typeof result.value.driftDetected).toBe("number");
      expect(Array.isArray(result.value.errors)).toBe(true);
    }
  });

  it("reconcileRepositoryMetadata detects default branch changes", async () => {
    const { createRestClient } = await import("../../src/github/client.js");
    vi.mocked(createRestClient).mockReturnValueOnce({
      repos: {
        get: vi.fn().mockResolvedValue({
          data: { default_branch: "develop", visibility: "private" },
        }),
      },
      // biome-ignore lint/suspicious/noExplicitAny: test mock
    } as any);

    const mockDb = createMockDb();
    // Mock repo query for reconcileRepositoryMetadata — ends at .from()
    mockDb._setFromResult([
      {
        id: "repo-1",
        owner: "testorg",
        repo: "testrepo",
        defaultBranch: "main",
      },
    ]);

    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileRepositoryMetadata();

    expect(result.driftDetected).toBe(1);
  });

  it("reconcileBranchProtection returns stub report", async () => {
    const mockDb = createMockDb();
    const config: BroadReconcilerConfig = {
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      db: mockDb as any,
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      credentialBroker: createMockCredentialBroker() as any,
    };

    const reconciler = createBroadReconciler(config);
    const result = await reconciler.reconcileBranchProtection();

    expect(result.driftDetected).toBe(0);
    expect(result.errors).toEqual([]);
  });
});
