import type { DbInstance } from "@software-factory/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexActivities } from "../../src/indexing/activities.js";

// Mock the indexer module
vi.mock("../../src/indexing/indexer.js", () => ({
  indexRepository: vi.fn(),
}));

// Mock @temporalio/activity to avoid needing a real Temporal context
vi.mock("@temporalio/activity", () => ({
  ApplicationFailure: {
    nonRetryable: (msg: string, code: string) => {
      const err = new Error(msg);
      (err as Error & { code: string }).code = code;
      return err;
    },
    retryable: (msg: string, code: string) => {
      const err = new Error(msg);
      (err as Error & { code: string }).code = code;
      return err;
    },
  },
  heartbeat: vi.fn(),
}));

import { createFactoryError } from "@software-factory/core";
import { heartbeat } from "@temporalio/activity";
import { err, ok } from "neverthrow";
import { indexRepository } from "../../src/indexing/indexer.js";

const mockDb = {} as DbInstance;

describe("createIndexActivities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wraps indexRepository correctly and returns IndexResult", async () => {
    const expectedResult = {
      indexVersionId: "idx-v1",
      totalFiles: 15,
      indexedFiles: 12,
      excludedFiles: 3,
      symbolCount: 100,
      dependencyCount: 45,
      durationMs: 2500,
      repoMap: [
        {
          filePath: "src/main.ts",
          rank: 0.95,
          keySymbols: ["main", "start"],
          lineCount: 42,
        },
      ],
    };

    vi.mocked(indexRepository).mockResolvedValue(ok(expectedResult));

    const activities = createIndexActivities({ db: mockDb });
    const result = await activities.indexRepositoryActivity(
      "/tmp/repo",
      "abc123",
      "repo-uuid",
      [],
    );

    expect(result).toEqual(expectedResult);
    expect(indexRepository).toHaveBeenCalledWith(
      "/tmp/repo",
      "abc123",
      "repo-uuid",
      [],
      mockDb,
    );
  });

  it("throws ApplicationFailure on indexing error", async () => {
    vi.mocked(indexRepository).mockResolvedValue(
      err(createFactoryError("unknown_internal", "parse failed")),
    );

    const activities = createIndexActivities({ db: mockDb });

    await expect(
      activities.indexRepositoryActivity("/tmp/repo", "sha", "id", []),
    ).rejects.toThrow("parse failed");
  });

  it("heartbeats during indexing operations", async () => {
    const expectedResult = {
      indexVersionId: "idx-v2",
      totalFiles: 5,
      indexedFiles: 5,
      excludedFiles: 0,
      symbolCount: 20,
      dependencyCount: 10,
      durationMs: 500,
      repoMap: [],
    };

    vi.mocked(indexRepository).mockResolvedValue(ok(expectedResult));

    const activities = createIndexActivities({ db: mockDb });
    await activities.indexRepositoryActivity("/tmp/repo", "sha", "id", []);

    expect(heartbeat).toHaveBeenCalledWith("starting indexing");
    expect(heartbeat).toHaveBeenCalledWith("indexing complete");
  });
});
