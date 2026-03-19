import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createReviewState,
  getReviewState,
  updateReviewState,
} from "../src/repositories/review-state-repository.js";
import { repos } from "../src/schema/repos.js";
import { tasks } from "../src/schema/tasks.js";
import { type TestContext, setupTestDb, teardownTestDb } from "./setup.js";

let ctx: TestContext;
let testRepoId: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  const [repo] = await ctx.db
    .insert(repos)
    .values({ githubOwner: "test", githubRepo: "review-state-test" })
    .returning();
  testRepoId = repo.id;
}, 120_000);

afterAll(async () => {
  await teardownTestDb(ctx);
});

async function createTestTask(
  objective = "review state test",
): Promise<string> {
  const [task] = await ctx.db
    .insert(tasks)
    .values({ objective, repoId: testRepoId, createdBy: "test-user" })
    .returning();
  return task.id;
}

describe("review state repository", () => {
  it("create review state: persisted correctly, returns valid data", async () => {
    const taskId = await createTestTask();

    const result = await createReviewState(ctx.db, {
      taskId,
      evidenceBundleId: null as unknown as string,
      prNumber: 42,
      prUrl: "https://github.com/test/repo/pull/42",
      prNodeId: "PR_node_abc",
      headSha: "abc123def456",
    });

    expect(result.isOk()).toBe(true);
    const row = result._unsafeUnwrap();
    expect(row.id).toBeDefined();
    expect(row.taskId).toBe(taskId);
    expect(row.prNumber).toBe(42);
    expect(row.prUrl).toBe("https://github.com/test/repo/pull/42");
    expect(row.prNodeId).toBe("PR_node_abc");
    expect(row.headSha).toBe("abc123def456");
    expect(row.mergeQueueStatus).toBe("none");
    expect(row.unresolvedThreads).toBe(0);
    expect(row.staleReviews).toBe(false);
    expect(row.lastGithubSync).toBeInstanceOf(Date);
  });

  it("get review state: returns correct data for existing task", async () => {
    const taskId = await createTestTask("get test");

    await createReviewState(ctx.db, {
      taskId,
      evidenceBundleId: null as unknown as string,
      prNumber: 99,
      prUrl: "https://github.com/test/repo/pull/99",
      prNodeId: "PR_node_xyz",
      headSha: "deadbeef",
    });

    const result = await getReviewState(ctx.db, taskId);
    expect(result.isOk()).toBe(true);
    const row = result._unsafeUnwrap();
    expect(row).not.toBeNull();
    expect(row?.taskId).toBe(taskId);
    expect(row?.prNumber).toBe(99);
    expect(row?.prUrl).toBe("https://github.com/test/repo/pull/99");
    expect(row?.prNodeId).toBe("PR_node_xyz");
    expect(row?.headSha).toBe("deadbeef");
  });

  it("update review state: fields updated correctly", async () => {
    const taskId = await createTestTask("update test");

    await createReviewState(ctx.db, {
      taskId,
      evidenceBundleId: null as unknown as string,
      prNumber: 10,
      prUrl: "https://github.com/test/repo/pull/10",
      prNodeId: "PR_node_upd",
      headSha: "sha_before",
    });

    const syncTime = new Date();
    const updateResult = await updateReviewState(ctx.db, taskId, {
      prNumber: 11,
      prUrl: "https://github.com/test/repo/pull/11",
      unresolvedThreads: 3,
      staleReviews: true,
      mergeQueueStatus: "queued",
      lastGithubSync: syncTime,
      githubReconciliationData: { checksRunning: true },
    });
    expect(updateResult.isOk()).toBe(true);

    const getResult = await getReviewState(ctx.db, taskId);
    const row = getResult._unsafeUnwrap();
    expect(row).not.toBeNull();
    expect(row?.prNumber).toBe(11);
    expect(row?.prUrl).toBe("https://github.com/test/repo/pull/11");
    expect(row?.unresolvedThreads).toBe(3);
    expect(row?.staleReviews).toBe(true);
    expect(row?.mergeQueueStatus).toBe("queued");
    expect(row?.lastGithubSync?.getTime()).toBe(syncTime.getTime());
    expect(row?.githubReconciliationData).toEqual({ checksRunning: true });
  });

  it("get review state for nonexistent task: returns ok(null)", async () => {
    const fakeTaskId = "00000000-0000-0000-0000-000000000000";
    const result = await getReviewState(ctx.db, fakeTaskId);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("unique constraint on taskId: second insert for same task fails", async () => {
    const taskId = await createTestTask("unique test");

    const first = await createReviewState(ctx.db, {
      taskId,
      evidenceBundleId: null as unknown as string,
      prNumber: 1,
      prUrl: "https://github.com/test/repo/pull/1",
      prNodeId: "PR_node_1",
      headSha: "sha1",
    });
    expect(first.isOk()).toBe(true);

    const second = await createReviewState(ctx.db, {
      taskId,
      evidenceBundleId: null as unknown as string,
      prNumber: 2,
      prUrl: "https://github.com/test/repo/pull/2",
      prNodeId: "PR_node_2",
      headSha: "sha2",
    });
    expect(second.isErr()).toBe(true);
  });

  it("partial update: only specified fields change", async () => {
    const taskId = await createTestTask("partial update test");

    await createReviewState(ctx.db, {
      taskId,
      evidenceBundleId: null as unknown as string,
      prNumber: 50,
      prUrl: "https://github.com/test/repo/pull/50",
      prNodeId: "PR_node_partial",
      headSha: "sha_partial",
    });

    await updateReviewState(ctx.db, taskId, {
      unresolvedThreads: 5,
    });

    const row = (await getReviewState(ctx.db, taskId))._unsafeUnwrap();
    expect(row).not.toBeNull();
    expect(row?.unresolvedThreads).toBe(5);
    // Original fields unchanged
    expect(row?.prNumber).toBe(50);
    expect(row?.prUrl).toBe("https://github.com/test/repo/pull/50");
    expect(row?.mergeQueueStatus).toBe("none");
    expect(row?.staleReviews).toBe(false);
  });
});
