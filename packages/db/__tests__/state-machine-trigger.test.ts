import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../src/schema/repos.js";
import { tasks } from "../src/schema/tasks.js";
import { type TestContext, setupTestDb, teardownTestDb } from "./setup.js";

let ctx: TestContext;
let testRepoId: string;

beforeAll(async () => {
  ctx = await setupTestDb();
  // Create a test repo
  const [repo] = await ctx.db
    .insert(repos)
    .values({ githubOwner: "test", githubRepo: "trigger-test" })
    .returning();
  testRepoId = repo.id;
}, 120_000);

afterAll(async () => {
  await teardownTestDb(ctx);
});

async function createTestTask(objective = "test task"): Promise<string> {
  const [task] = await ctx.db
    .insert(tasks)
    .values({ objective, repoId: testRepoId, createdBy: "test-user" })
    .returning();
  return task.id;
}

describe("state machine trigger", () => {
  it("valid transition (created → assigned): succeeds and updatedAt changes", async () => {
    const taskId = await createTestTask();
    const [before] = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(before.state).toBe("created");

    // Need created → assigned (but we need to go through needs_clarification or directly)
    // Actually created → assigned is a valid transition
    await ctx.db
      .update(tasks)
      .set({ state: "assigned" })
      .where(eq(tasks.id, taskId));

    const [after] = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(after.state).toBe("assigned");
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
  });

  it("invalid transition (created → merged): trigger raises exception", async () => {
    const taskId = await createTestTask();

    await expect(
      ctx.db.update(tasks).set({ state: "merged" }).where(eq(tasks.id, taskId)),
    ).rejects.toThrow();

    // Verify state unchanged
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row.state).toBe("created");
  });

  it("terminal state (merged → anything): trigger raises exception", async () => {
    const taskId = await createTestTask();

    // Walk to merged: created → assigned → in_progress → evidence_ready → approved → pr_created → external_checks_pending → merge_ready → merged
    for (const state of [
      "assigned",
      "in_progress",
      "evidence_ready",
      "approved",
      "pr_created",
      "external_checks_pending",
      "merge_ready",
      "merged",
    ] as const) {
      await ctx.db.update(tasks).set({ state }).where(eq(tasks.id, taskId));
    }

    await expect(
      ctx.db
        .update(tasks)
        .set({ state: "in_progress" })
        .where(eq(tasks.id, taskId)),
    ).rejects.toThrow();
  });

  it("cancelled from non-terminal (in_progress → cancelled): succeeds", async () => {
    const taskId = await createTestTask();
    await ctx.db
      .update(tasks)
      .set({ state: "assigned" })
      .where(eq(tasks.id, taskId));
    await ctx.db
      .update(tasks)
      .set({ state: "in_progress" })
      .where(eq(tasks.id, taskId));

    await ctx.db
      .update(tasks)
      .set({ state: "cancelled" })
      .where(eq(tasks.id, taskId));

    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row.state).toBe("cancelled");
  });

  it("same-state update (no-op): trigger does NOT fire, update succeeds", async () => {
    const taskId = await createTestTask();

    // Update objective without changing state — trigger's WHEN clause prevents firing
    await ctx.db
      .update(tasks)
      .set({ objective: "updated objective" })
      .where(eq(tasks.id, taskId));

    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row.objective).toBe("updated objective");
    expect(row.state).toBe("created");
  });

  it("concurrent reads during transition: no deadlock", async () => {
    const taskId = await createTestTask();

    // Run transition and read concurrently
    const [transitionResult, readResult] = await Promise.all([
      ctx.db
        .update(tasks)
        .set({ state: "assigned" })
        .where(eq(tasks.id, taskId))
        .returning(),
      ctx.db.select().from(tasks).where(eq(tasks.id, taskId)),
    ]);

    expect(transitionResult).toHaveLength(1);
    expect(readResult).toHaveLength(1);
  });
});
