import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transitionTaskState } from "../src/repositories/task-repository.js";
import { auditEntries } from "../src/schema/audit-entries.js";
import { repos } from "../src/schema/repos.js";
import { tasks } from "../src/schema/tasks.js";
import { computeContentHash } from "../src/utils/content-hash.js";
import { type TestContext, setupTestDb, teardownTestDb } from "./setup.js";

let ctx: TestContext;
let testRepoId: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  const [repo] = await ctx.db
    .insert(repos)
    .values({ githubOwner: "test", githubRepo: "txn-audit-test" })
    .returning();
  testRepoId = repo.id;
}, 120_000);

afterAll(async () => {
  await teardownTestDb(ctx);
});

async function createTestTask(): Promise<string> {
  const [task] = await ctx.db
    .insert(tasks)
    .values({ objective: "txn test", repoId: testRepoId, createdBy: "tester" })
    .returning();
  return task.id;
}

describe("transactional audit", () => {
  it("transitionTaskState: both state change AND audit entry exist after success", async () => {
    const taskId = await createTestTask();
    const content = {
      fromState: "created",
      toState: "assigned",
      reason: "test",
    };

    const result = await transitionTaskState(
      ctx.db,
      taskId,
      "assigned",
      "test-actor",
      content,
    );
    expect(result.isOk()).toBe(true);

    // Verify state changed
    const [task] = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(task.state).toBe("assigned");

    // Verify audit entry exists
    const entries = await ctx.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.taskId, taskId));
    expect(entries).toHaveLength(1);
    expect(entries[0].actionType).toBe("task_state_change");
    expect(entries[0].actor).toBe("test-actor");
  });

  it("transitionTaskState with invalid transition: NEITHER state change NOR audit entry persists", async () => {
    const taskId = await createTestTask();

    // Count existing audit entries for this task
    const beforeEntries = await ctx.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.taskId, taskId));
    expect(beforeEntries).toHaveLength(0);

    const result = await transitionTaskState(
      ctx.db,
      taskId,
      "merged",
      "test-actor",
    );
    expect(result.isErr()).toBe(true);

    // Verify state unchanged
    const [task] = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(task.state).toBe("created");

    // Verify no audit entry was created
    const afterEntries = await ctx.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.taskId, taskId));
    expect(afterEntries).toHaveLength(0);
  });

  it("content hash in audit entry matches recomputed hash", async () => {
    const taskId = await createTestTask();
    const content = {
      fromState: "created",
      toState: "assigned",
      context: "hash-test",
    };

    await transitionTaskState(
      ctx.db,
      taskId,
      "assigned",
      "hash-actor",
      content,
    );

    const [entry] = await ctx.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.taskId, taskId));

    const recomputed = computeContentHash(entry.content);
    expect(entry.contentHash).toBe(recomputed);
  });

  it("audit entry actor, actionType, targetId are correct", async () => {
    const taskId = await createTestTask();
    await transitionTaskState(ctx.db, taskId, "assigned", "specific-actor");

    const [entry] = await ctx.db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.taskId, taskId));

    expect(entry.actor).toBe("specific-actor");
    expect(entry.actionType).toBe("task_state_change");
    expect(entry.targetType).toBe("task");
    expect(entry.targetId).toBe(taskId);
  });
});
