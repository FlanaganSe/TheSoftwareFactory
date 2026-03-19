import { CapabilitySnapshotSchema } from "@software-factory/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { scanRepository } from "../../src/github/capability-scan.js";
import type { ScanLogger } from "../../src/github/capability-scan.js";
import type { CredentialBroker } from "../../src/github/credential-broker.js";

// Mock the client module so we can control the Octokit instance
vi.mock("../../src/github/client.js", () => ({
  createRestClient: vi.fn(),
  createGraphQLClient: vi.fn(),
  RATE_LIMIT_HEADERS: [
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "x-ratelimit-used",
    "x-ratelimit-resource",
  ],
}));

import { createRestClient } from "../../src/github/client.js";

const RATE_LIMIT_HEADERS = {
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": "4999",
  "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
  "x-ratelimit-used": "1",
  "x-ratelimit-resource": "core",
};

function makeMockBroker(): CredentialBroker {
  return {
    getToken: vi.fn().mockResolvedValue("mock-token"),
    getTokenForState: vi.fn().mockResolvedValue("mock-token"),
  } as unknown as CredentialBroker;
}

function makeRepoResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 12345,
      node_id: "R_abc123",
      name: "test-repo",
      full_name: "owner/test-repo",
      default_branch: "main",
      private: false,
      visibility: "public",
      archived: false,
      fork: false,
      has_wiki: true,
      has_projects: false,
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
      ...overrides,
    },
    headers: RATE_LIMIT_HEADERS,
  };
}

function makeCommitResponse() {
  return {
    data: { sha: "abc123def456789" },
    headers: RATE_LIMIT_HEADERS,
  };
}

function makeOctokitMock(overrides: Record<string, unknown> = {}) {
  const repoOverrides = (overrides.repoData as Record<string, unknown>) ?? {};
  const branchProtectionError = overrides.branchProtectionError as
    | { status: number }
    | undefined;
  const rulesetsData =
    (overrides.rulesetsData as Array<Record<string, unknown>>) ?? [];
  const codeownersPath = overrides.codeownersPath as string | undefined;
  const codeownersContent = overrides.codeownersContent as string | undefined;
  const environments = (overrides.environments as string[]) ?? [];
  const workflowFiles =
    (overrides.workflowFiles as Array<{
      name: string;
      path: string;
      content: string;
    }>) ?? [];

  return {
    repos: {
      get: vi.fn().mockResolvedValue(makeRepoResponse(repoOverrides)),
      getCommit: vi.fn().mockResolvedValue(makeCommitResponse()),
      getBranchProtection: branchProtectionError
        ? vi.fn().mockRejectedValue(branchProtectionError)
        : vi.fn().mockResolvedValue({
            data: {
              required_pull_request_reviews: {
                required_approving_review_count: 1,
                dismiss_stale_reviews: false,
                require_code_owner_reviews: false,
                require_last_push_approval: false,
              },
              required_status_checks: {
                contexts: ["ci/build"],
                checks: [],
              },
              enforce_admins: { enabled: false },
              required_linear_history: { enabled: false },
              allow_force_pushes: { enabled: false },
              allow_deletions: { enabled: false },
              required_signatures: { enabled: false },
              required_conversation_resolution: { enabled: false },
              restrictions: null,
            },
            headers: RATE_LIMIT_HEADERS,
          }),
      getContent: vi.fn().mockImplementation(({ path }: { path: string }) => {
        // CODEOWNERS
        if (path.endsWith("CODEOWNERS")) {
          if (codeownersPath && path === codeownersPath) {
            return Promise.resolve({
              data: {
                type: "file",
                content: Buffer.from(
                  codeownersContent ?? "* @default-owner\n",
                ).toString("base64"),
                encoding: "base64",
              },
              headers: RATE_LIMIT_HEADERS,
            });
          }
          return Promise.reject({ status: 404 });
        }

        // Workflow directory listing
        if (path === ".github/workflows") {
          if (workflowFiles.length === 0) {
            return Promise.reject({ status: 404 });
          }
          return Promise.resolve({
            data: workflowFiles.map((f) => ({
              type: "file",
              name: f.name,
              path: f.path,
            })),
            headers: RATE_LIMIT_HEADERS,
          });
        }

        // Individual workflow files
        const wf = workflowFiles.find((f) => f.path === path);
        if (wf) {
          return Promise.resolve({
            data: {
              type: "file",
              content: Buffer.from(wf.content).toString("base64"),
              encoding: "base64",
            },
            headers: RATE_LIMIT_HEADERS,
          });
        }

        return Promise.reject({ status: 404 });
      }),
      getAllEnvironments: vi.fn().mockResolvedValue({
        data: {
          environments: environments.map((name) => ({ name })),
        },
        headers: RATE_LIMIT_HEADERS,
      }),
    },
    request: vi
      .fn()
      .mockImplementation((route: string, params?: Record<string, unknown>) => {
        // Detail endpoint: has {ruleset_id} template param
        if (route.includes("{ruleset_id}")) {
          const id = (params?.ruleset_id as number) ?? 1;
          const ruleset = rulesetsData[id - 1] ?? {};
          return Promise.resolve({
            data: {
              id,
              name: "ruleset",
              target: "branch",
              enforcement: "active",
              source_type: "Repository",
              source: "owner/test-repo",
              bypass_actors: [],
              conditions: {
                ref_name: {
                  include: ["refs/heads/main"],
                  exclude: [],
                },
              },
              rules: [],
              ...ruleset,
            },
            headers: RATE_LIMIT_HEADERS,
          });
        }
        // List endpoint
        if (route.includes("/rulesets")) {
          return Promise.resolve({
            data: rulesetsData.map((r, i) => ({ id: i + 1, ...r })),
            headers: RATE_LIMIT_HEADERS,
          });
        }
        return Promise.resolve({
          data: [],
          headers: RATE_LIMIT_HEADERS,
        });
      }),
  };
}

const spyLogger: ScanLogger = {
  info: vi.fn(),
  warn: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scanRepository", () => {
  it("produces valid CapabilitySnapshot for standard repo", async () => {
    const mock = makeOctokitMock();
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
      spyLogger,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const snapshot = result.value;
      const validated = CapabilitySnapshotSchema.safeParse(snapshot);
      expect(validated.success).toBe(true);
      expect(snapshot.defaultBranch).toBe("main");
      expect(snapshot.visibility).toBe("public");
      expect(snapshot.isArchived).toBe(false);
      expect(snapshot.isFork).toBe(false);
    }
  });

  it("handles no branch protection (404) gracefully", async () => {
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
      spyLogger,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.branchProtection).toBe(null);
    }
  });

  it("repo with only rulesets (no legacy protection) works", async () => {
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
      rulesetsData: [
        {
          name: "main-protection",
          rules: [
            {
              type: "pull_request",
              parameters: { required_approving_review_count: 2 },
            },
          ],
        },
      ],
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.branchProtection).toBe(null);
      expect(result.value.rulesets).toHaveLength(1);
      expect(result.value.requiredReviewCount).toBe(2);
    }
  });

  it("captures both legacy protection and rulesets", async () => {
    const mock = makeOctokitMock({
      rulesetsData: [
        {
          name: "extra-protection",
          rules: [{ type: "required_signatures" }],
        },
      ],
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.branchProtection).not.toBe(null);
      expect(result.value.rulesets).toHaveLength(1);
      expect(result.value.requiresSignedCommits).toBe(true);
    }
  });

  it("generates warning for archived repo", async () => {
    const mock = makeOctokitMock({
      repoData: { archived: true },
      branchProtectionError: { status: 404 },
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.isArchived).toBe(true);
      expect(result.value.warnings).toContain(
        "Repository is archived — limited capabilities available",
      );
      expect(result.value.supportedByFactory).toBe(false);
    }
  });

  it("detects pull_request_target workflows", async () => {
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
      workflowFiles: [
        {
          name: "pr-target.yml",
          path: ".github/workflows/pr-target.yml",
          content:
            "name: PR Target\non:\n  pull_request_target:\n    types: [opened]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n",
        },
      ],
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.hasPullRequestTargetWorkflows).toBe(true);
      expect(result.value.pullRequestTargetWorkflowPaths).toContain(
        ".github/workflows/pr-target.yml",
      );
    }
  });

  it("detects merge queue from rulesets", async () => {
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
      rulesetsData: [
        {
          name: "mq",
          rules: [
            {
              type: "merge_queue",
              parameters: {
                merge_method: "squash",
                min_entries_to_merge: 1,
                max_entries_to_merge: 5,
              },
            },
          ],
        },
      ],
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.mergeQueue).not.toBe(null);
      expect(result.value.mergeQueue?.enabled).toBe(true);
    }
  });

  it("finds CODEOWNERS in .github/ location", async () => {
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
      codeownersPath: ".github/CODEOWNERS",
      codeownersContent: "*.ts @ts-team\n",
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.codeowners).not.toBe(null);
      expect(result.value.codeowners?.found).toBe(true);
      expect(result.value.codeowners?.location).toBe(".github/CODEOWNERS");
    }
  });

  it("returns null codeowners when not found", async () => {
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.codeowners).toBe(null);
    }
  });

  it("logs rate limit headers", async () => {
    const logger: ScanLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    await scanRepository("owner", "test-repo", makeMockBroker(), 1, logger);

    expect(logger.info).toHaveBeenCalledWith(
      "Rate limit",
      expect.objectContaining({
        remaining: expect.any(Number),
        limit: expect.any(Number),
      }),
    );
  });

  it("uses credential broker with capability_scan phase", async () => {
    const broker = makeMockBroker();
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    await scanRepository("owner", "test-repo", broker, 1);

    expect(broker.getToken).toHaveBeenCalledWith("capability_scan");
  });

  it("captures environments", async () => {
    const mock = makeOctokitMock({
      branchProtectionError: { status: 404 },
      environments: ["staging", "production"],
    });
    vi.mocked(createRestClient).mockReturnValue(mock as never);

    const result = await scanRepository(
      "owner",
      "test-repo",
      makeMockBroker(),
      1,
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.environments).toEqual(["staging", "production"]);
    }
  });
});
