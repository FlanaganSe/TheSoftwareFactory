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
    await apiKeyRepo.createApiKey(db, "role-admin", "admin", "test")
  )._unsafeUnwrap().rawKey;
  operatorKey = (
    await apiKeyRepo.createApiKey(db, "role-operator", "operator", "test")
  )._unsafeUnwrap().rawKey;
  viewerKey = (
    await apiKeyRepo.createApiKey(db, "role-viewer", "viewer", "test")
  )._unsafeUnwrap().rawKey;
}, 120_000);

afterAll(async () => {
  await teardownTestApp(ctx);
});

describe("role authorization", () => {
  // Admin-only route: POST /api/keys
  it("viewer accessing admin-only route → 403", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { authorization: `Bearer ${viewerKey}` },
      payload: { label: "test", role: "viewer" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("operator accessing admin-only route → 403", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { authorization: `Bearer ${operatorKey}` },
      payload: { label: "test", role: "viewer" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin accessing admin-only route → succeeds", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { authorization: `Bearer ${adminKey}` },
      payload: { label: "role-test-key", role: "viewer" },
    });
    expect(res.statusCode).toBe(201);
  });

  // Operator route: POST /api/tasks
  it("operator accessing operator route → succeeds (503 no Temporal)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${operatorKey}` },
      payload: {
        objective: "test task",
        repoOwner: "test-org",
        repoName: "test-repo",
      },
    });
    expect(res.statusCode).toBe(503); // Temporal not configured, not 403
  });

  it("viewer accessing operator route → 403", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${viewerKey}` },
      payload: {
        objective: "test task",
        repoOwner: "test-org",
        repoName: "test-repo",
      },
    });
    expect(res.statusCode).toBe(403);
  });

  // Read-only route: GET /api/tasks
  it("viewer accessing read-only route → passes", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/tasks",
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.statusCode).toBe(503); // Temporal not configured, not 403
  });
});
