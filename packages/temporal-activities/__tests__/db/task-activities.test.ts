import { repos } from "@software-factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type TestContext,
  setupTestDb,
  teardownTestDb,
} from "../../../db/__tests__/setup.js";
import { createTaskActivities } from "../../src/db/task-activities.js";

let ctx: TestContext;
let testRepoId: string;
let activities: ReturnType<typeof createTaskActivities>;

beforeAll(async () => {
  ctx = await setupTestDb();
  const [repo] = await ctx.db
    .insert(repos)
    .values({ githubOwner: "test", githubRepo: "task-act-test" })
    .returning();
  testRepoId = repo.id;
  activities = createTaskActivities(ctx.db);
}, 120_000);

afterAll(async () => {
  await teardownTestDb(ctx);
});

describe("createTask", () => {
  it("creates a task with state 'created'", async () => {
    const task = await activities.createTask({
      objective: "Test task",
      repoId: testRepoId,
      createdBy: "tester",
    });
    expect(task.id).toBeDefined();
    expect(task.state).toBe("created");
    expect(task.objective).toBe("Test task");
  });
});

describe("transitionTaskState", () => {
  it("transitions valid state change with audit entry", async () => {
    const task = await activities.createTask({
      objective: "Transition test",
      repoId: testRepoId,
      createdBy: "tester",
    });
    const updated = await activities.transitionTaskState(
      task.id,
      "assigned",
      "tester",
      { phase: "intake" },
    );
    expect(updated.state).toBe("assigned");
  });

  it("throws ApplicationFailure for invalid transition", async () => {
    const task = await activities.createTask({
      objective: "Invalid transition",
      repoId: testRepoId,
      createdBy: "tester",
    });
    // created → merged is not a valid transition
    await expect(
      activities.transitionTaskState(task.id, "merged", "tester", {}),
    ).rejects.toThrow();
  });
});

describe("getTask", () => {
  it("returns the correct task", async () => {
    const created = await activities.createTask({
      objective: "Get test",
      repoId: testRepoId,
      createdBy: "tester",
    });
    const fetched = await activities.getTask(created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.objective).toBe("Get test");
  });

  it("throws for non-existent task", async () => {
    await expect(
      activities.getTask("00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow();
  });
});

describe("listActiveTasks", () => {
  it("returns non-terminal tasks", async () => {
    const task = await activities.createTask({
      objective: "List test",
      repoId: testRepoId,
      createdBy: "tester",
    });
    const active = await activities.listActiveTasks(testRepoId);
    expect(active.some((t) => t.id === task.id)).toBe(true);
  });
});
