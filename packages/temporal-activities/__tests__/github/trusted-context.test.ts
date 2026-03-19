import { TrustedBaseContextSchema } from "@software-factory/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CredentialBroker } from "../../src/github/credential-broker.js";
import { createTrustedContextActivities } from "../../src/github/trusted-context.js";

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
      getRef: vi.fn(),
    },
    repos: {
      getContent: vi.fn(),
    },
  };
}

describe("createTrustedContextActivities", () => {
  let broker: CredentialBroker;
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    broker = makeMockBroker();
    mockClient = makeMockClient();
    vi.mocked(createRestClient).mockReturnValue(mockClient as never);
  });

  it("captures HEAD SHA of default branch", async () => {
    const activities = createTrustedContextActivities({
      credentialBroker: broker,
    });

    mockClient.git.getRef.mockResolvedValue({
      data: { object: { sha: "abc123def456" } },
    });

    // All file fetches return 404 (no control files)
    mockClient.repos.getContent.mockRejectedValue({ status: 404 });

    const result = await activities.captureTrustedContext(
      "owner",
      "repo",
      "main",
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().baseSha).toBe("abc123def456");

    expect(mockClient.git.getRef).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      ref: "heads/main",
    });
  });

  it("fetches .factory/setup.yml from pinned SHA", async () => {
    const activities = createTrustedContextActivities({
      credentialBroker: broker,
    });

    mockClient.git.getRef.mockResolvedValue({
      data: { object: { sha: "sha-123" } },
    });

    const setupYml = `version: "1"
image: node:22-slim
setup:
  - npm install
maintenance: []
secrets:
  setup_only: []
  runtime: []
  per_tool: []
health_check:
  - node --version`;

    mockClient.repos.getContent.mockImplementation(
      async ({ path, ref }: { path: string; ref: string }) => {
        if (path === ".factory/setup.yml") {
          expect(ref).toBe("sha-123"); // Pinned SHA, not "main"
          return {
            data: {
              content: Buffer.from(setupYml).toString("base64"),
            },
          };
        }
        throw { status: 404 };
      },
    );

    const result = await activities.captureTrustedContext(
      "owner",
      "repo",
      "main",
    );

    expect(result.isOk()).toBe(true);
    const ctx = result._unsafeUnwrap();
    expect(ctx.setupContract).not.toBeNull();
    expect(ctx.setupContract?.image).toBe("node:22-slim");
  });

  it("returns null setupContract when .factory/setup.yml missing", async () => {
    const activities = createTrustedContextActivities({
      credentialBroker: broker,
    });

    mockClient.git.getRef.mockResolvedValue({
      data: { object: { sha: "sha-456" } },
    });

    mockClient.repos.getContent.mockRejectedValue({ status: 404 });

    const result = await activities.captureTrustedContext(
      "owner",
      "repo",
      "main",
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().setupContract).toBeNull();
  });

  it("fetches behavioral control files and computes hashes", async () => {
    const activities = createTrustedContextActivities({
      credentialBroker: broker,
    });

    mockClient.git.getRef.mockResolvedValue({
      data: { object: { sha: "sha-789" } },
    });

    mockClient.repos.getContent.mockImplementation(
      async ({ path }: { path: string }) => {
        if (path === "CLAUDE.md") {
          return {
            data: {
              content: Buffer.from("# Claude Rules").toString("base64"),
            },
          };
        }
        if (path === "AGENTS.md") {
          return {
            data: {
              content: Buffer.from("# Agent Config").toString("base64"),
            },
          };
        }
        throw { status: 404 };
      },
    );

    const result = await activities.captureTrustedContext(
      "owner",
      "repo",
      "main",
    );

    expect(result.isOk()).toBe(true);
    const ctx = result._unsafeUnwrap();
    expect(ctx.behavioralControlFiles["CLAUDE.md"]).toBe("# Claude Rules");
    expect(ctx.behavioralControlFiles["AGENTS.md"]).toBe("# Agent Config");
    expect(ctx.validationCommandSources.length).toBe(2);
    // Each entry is path:sha256hash
    for (const src of ctx.validationCommandSources) {
      expect(src).toMatch(/^(CLAUDE\.md|AGENTS\.md):[a-f0-9]{64}$/);
    }
  });

  it("returned context validates against TrustedBaseContextSchema", async () => {
    const activities = createTrustedContextActivities({
      credentialBroker: broker,
    });

    mockClient.git.getRef.mockResolvedValue({
      data: { object: { sha: "sha-abc" } },
    });

    mockClient.repos.getContent.mockRejectedValue({ status: 404 });

    const result = await activities.captureTrustedContext(
      "owner",
      "repo",
      "main",
    );

    expect(result.isOk()).toBe(true);
    const ctx = result._unsafeUnwrap();

    const validation = TrustedBaseContextSchema.safeParse(ctx);
    expect(validation.success).toBe(true);
  });
});
