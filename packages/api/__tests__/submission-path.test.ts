import { apiKeyRepo, repoRepo, taskRepo } from "@software-factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;
let adminKey: string;

beforeAll(async () => {
  ctx = await setupTestApp();
  const db = ctx.dbConnection.db;

  adminKey = (
    await apiKeyRepo.createApiKey(db, "sub-admin", "admin", "test")
  )._unsafeUnwrap().rawKey;
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("submission path — repo + task creation", () => {
  it("getOrCreateRepo creates a new repo row", async () => {
    const db = ctx.dbConnection.db;
    const result = await repoRepo.getOrCreateRepo(db, "acme-org", "web-app");

    expect(result.isOk()).toBe(true);
    const repo = result._unsafeUnwrap();
    expect(repo.githubOwner).toBe("acme-org");
    expect(repo.githubRepo).toBe("web-app");
    expect(repo.id).toBeDefined();

    // Verify via getRepo — the row actually exists in the DB
    const lookup = await repoRepo.getRepo(db, repo.id);
    expect(lookup.isOk()).toBe(true);
    expect(lookup._unsafeUnwrap().githubOwner).toBe("acme-org");
  });

  it("createTask creates a task with correct repo FK", async () => {
    const db = ctx.dbConnection.db;

    const repoResult = await repoRepo.getOrCreateRepo(
      db,
      "acme-org",
      "backend",
    );
    const repo = repoResult._unsafeUnwrap();

    const taskResult = await taskRepo.createTask(db, {
      objective: "Add input validation",
      repoId: repo.id,
      autonomyLevel: "L1",
      createdBy: "test-actor",
    });

    expect(taskResult.isOk()).toBe(true);
    const task = taskResult._unsafeUnwrap();
    expect(task.repoId).toBe(repo.id);
    expect(task.objective).toBe("Add input validation");
    expect(task.state).toBe("created");

    // Verify FK relationship via getTask
    const lookup = await taskRepo.getTask(db, task.id);
    expect(lookup.isOk()).toBe(true);
    expect(lookup._unsafeUnwrap().repoId).toBe(repo.id);
  });

  it("getOrCreateRepo is idempotent — same slug returns same repo", async () => {
    const db = ctx.dbConnection.db;

    const first = await repoRepo.getOrCreateRepo(db, "idempotent-org", "repo");
    const second = await repoRepo.getOrCreateRepo(db, "idempotent-org", "repo");

    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
    expect(first._unsafeUnwrap().id).toBe(second._unsafeUnwrap().id);

    // Verify only one row exists — listRepos and filter
    const allRepos = await repoRepo.listRepos(db);
    const matching = allRepos
      ._unsafeUnwrap()
      .filter((r) => r.githubOwner === "idempotent-org");
    expect(matching).toHaveLength(1);
  });

  it("GET /api/tasks returns tasks created via DB", async () => {
    const db = ctx.dbConnection.db;

    // Create repo + task directly in DB
    const repoResult = await repoRepo.getOrCreateRepo(
      db,
      "list-org",
      "list-repo",
    );
    const repo = repoResult._unsafeUnwrap();

    await taskRepo.createTask(db, {
      objective: "Task for listing test",
      repoId: repo.id,
      autonomyLevel: "L2",
      createdBy: "test-actor",
    });

    // Query via API — GET /api/tasks reads from DB, no Temporal needed
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${adminKey}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const found = body.tasks.find(
      (t: { objective: string }) => t.objective === "Task for listing test",
    );
    expect(found).toBeDefined();
    expect(found.repoId).toBe(repo.id);
    expect(found.status).toBe("created");
  });
});
