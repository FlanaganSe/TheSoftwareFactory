import { apiKeyRepo } from "@software-factory/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestContext, setupTestApp, teardownTestApp } from "./setup.js";

let ctx: TestContext;
let adminKey: string;
let operatorKey: string;
let viewerKey: string;

beforeAll(async () => {
  ctx = await setupTestApp();

  const db = ctx.dbConnection.db;
  adminKey = (
    await apiKeyRepo.createApiKey(db, "task-admin", "admin", "test")
  )._unsafeUnwrap().rawKey;
  operatorKey = (
    await apiKeyRepo.createApiKey(db, "task-operator", "operator", "test")
  )._unsafeUnwrap().rawKey;
  viewerKey = (
    await apiKeyRepo.createApiKey(db, "task-viewer", "viewer", "test")
  )._unsafeUnwrap().rawKey;
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("tasks API", () => {
  it("POST /api/tasks without auth → 401", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: {
        objective: "Add tests",
        repoOwner: "org",
        repoName: "repo",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/tasks with viewer role → 403", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${viewerKey}` },
      payload: {
        objective: "Add tests",
        repoOwner: "org",
        repoName: "repo",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /api/tasks with missing objective → 400", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        repoOwner: "org",
        repoName: "repo",
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("validation_error");
  });

  it("POST /api/tasks with operator role → 503 (no Temporal)", async () => {
    // Without a Temporal client configured, returns 503
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${operatorKey}` },
      payload: {
        objective: "Add unit tests",
        repoOwner: "test-org",
        repoName: "test-repo",
      },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("service_unavailable");
  });

  it("POST /api/tasks with admin role → 503 (no Temporal)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: {
        objective: "Add a README",
        repoOwner: "test-org",
        repoName: "test-repo",
        autonomyLevel: "L1",
      },
    });
    // Without Temporal client, should be 503
    expect(res.statusCode).toBe(503);
  });

  it("GET /api/tasks without auth → 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/tasks with auth → 200 (empty list from DB)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tasks).toEqual([]);
  });

  it("GET /api/tasks/:id without auth → 401", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks/some-task-id",
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /api/tasks/:id with auth → 503 (no Temporal)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks/some-task-id",
      headers: { authorization: `Bearer ${adminKey}` },
    });
    expect(res.statusCode).toBe(503);
  });
});
